const express = require("express");
const { body, param, validationResult } = require("express-validator");
const { User, ROLES } = require("../models/user.model");
const { auth, isAdmin, isEditor, isViewer } = require("../middleware/auth");
const { globalLimiter, usernameLimiter } = require("../middleware/rateLimit");
const {
  checkBloomFilter,
  cacheGet,
  cacheSet,
  CACHE_KEYS,
} = require("../config/redis");

const router = express.Router();

// Helper function to generate cache key based on query params
const generateCacheKey = (query) => {
  const {
    page = 1,
    limit = 20,
    sort = "createdAt",
    order = "desc",
    role,
    search,
  } = query;
  return `${CACHE_KEYS.ALL_USERS}:${page}:${limit}:${sort}:${order}:${
    role || "all"
  }:${search || "none"}`;
};

// Validation middleware
const validateUserUpdate = [
  body("email").if(body("email").exists()).isEmail().normalizeEmail(),
  body("password").if(body("password").exists()).isLength({ min: 8 }),
  body("fullName").if(body("fullName").exists()).trim().escape(),
  body("username")
    .if(body("username").exists())
    .trim()
    .isLength({ min: 3, max: 30 })
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage("Username can only contain letters, numbers, underscores and hyphens"),
  body("role")
    .if(body("role").exists())
    .isIn(Object.values(ROLES))
    .withMessage(`Role must be one of: ${Object.values(ROLES).join(", ")}`),
];

// Get own user info
router.get("/", [globalLimiter, auth, isViewer], async (req, res) => {
  res.json({
    data: {
      user: req.user,
    },
  });
});

// Get all users (admin/editor only)
router.get("/all", [globalLimiter, auth, isEditor], async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      sort = "createdAt",
      order = "desc",
      role,
      search,
    } = req.query;

    // Validate query parameters
    const validLimit = Math.min(Math.max(1, parseInt(limit)), 100);
    const validPage = Math.max(1, parseInt(page));
    const validSort = ["createdAt", "username", "email"].includes(sort)
      ? sort
      : "createdAt";
    const validOrder = ["asc", "desc"].includes(order) ? order : "desc";

    // Generate cache key based on query parameters
    const cacheKey = generateCacheKey(req.query);

    // Try cache first
    const cachedResult = await cacheGet(cacheKey);
    if (cachedResult) {
      return res.json(cachedResult);
    }

    // Build MongoDB query
    const query = {};
    if (role) {
      query.role = role;
    }
    if (search) {
      query.$or = [
        { username: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { fullName: { $regex: search, $options: "i" } },
      ];
    }

    // Execute query with pagination
    const users = await User.find(query)
      .sort({ [validSort]: validOrder === "desc" ? -1 : 1 })
      .skip((validPage - 1) * validLimit)
      .limit(validLimit);

    const total = await User.countDocuments(query);

    const result = {
      metadata: {
        page: validPage,
        limit: validLimit,
        total,
        totalPages: Math.ceil(total / validLimit),
      },
      data: {
        users,
      },
    };

    // Cache the results
    await cacheSet(cacheKey, result, 300); // Cache for 5 minutes

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Validate username availability
router.get("/validate/:username", usernameLimiter, async (req, res) => {
  try {
    const { username } = req.params;

    // Check Bloom filter first for quick response
    const mightExist = await checkBloomFilter(username);

    if (!mightExist) {
      // If username is definitely not in Bloom filter, it's available
      return res.json({
        data: {
          available: true,
        },
      });
    }

    // If might exist, do a proper database check
    const exists = await User.findByUsername(username);
    res.json({
      data: {
        available: !exists,
      },
    });
  } catch (error) {
    res.status(500).json({
      error: {
        code: "SERVER_ERROR",
        message: "Error checking username availability",
      },
    });
  }
});

// Update user
router.patch(
  "/:username",
  [globalLimiter, auth, isEditor, validateUserUpdate],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "Validation Error",
            details: errors.array().map((err) => ({
              field: err.path,
              message: err.msg,
            })),
          },
        });
      }

      const { username } = req.params;
      const updates = req.body;

      // Define allowed fields
      const allowedFields = ["email", "password", "fullName", "username", "role"];
      
      // Filter out any fields that aren't in allowedFields
      const filteredUpdates = Object.keys(updates)
        .filter(key => allowedFields.includes(key))
        .reduce((obj, key) => {
          obj[key] = updates[key];
          return obj;
        }, {});

      // Check if any valid fields are provided
      if (Object.keys(filteredUpdates).length === 0) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "No valid update fields provided",
          },
        });
      }

      // Find user
      const user = await User.findByUsername(username);
      if (!user) {
        return res.status(404).json({
          error: {
            code: "RESOURCE_NOT_FOUND",
            message: "User not found",
          },
        });
      }

      // Check email uniqueness if email is being updated
      if (filteredUpdates.email && filteredUpdates.email !== user.email) {
        const existingUser = await User.findByEmail(filteredUpdates.email);
        if (existingUser) {
          return res.status(400).json({
            error: {
              code: "DUPLICATE_ERROR",
              message: "Email already exists",
            },
          });
        }
      }

      // Check username uniqueness if username is being updated
      if (filteredUpdates.username && filteredUpdates.username !== username) {
        const existingUser = await User.findByUsername(filteredUpdates.username);
        if (existingUser) {
          return res.status(400).json({
            error: {
              code: "DUPLICATE_ERROR",
              message: "Username already exists",
            },
          });
        }
      }

      // Handle role update (admin only)
      if (filteredUpdates.role !== undefined) {
        if (req.user.role !== ROLES.ADMIN) {
          return res.status(403).json({
            error: {
              code: "AUTHORIZATION_ERROR",
              message: "Only admins can update user roles",
            },
          });
        }
      }

      // Update user fields
      Object.keys(filteredUpdates).forEach((field) => {
        if (filteredUpdates[field] !== undefined) {
          user[field] = filteredUpdates[field];
        }
      });

      await user.save();

      // Remove password from response
      const userResponse = user.toJSON();
      delete userResponse.password;

      res.json({
        data: {
          user: userResponse,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// Delete user (admin only)
router.delete("/:username", [globalLimiter, auth, isAdmin], async (req, res, next) => {
  try {
    const { username } = req.params;

    // Find and delete user
    const user = await User.findOneAndDelete({ username });
    if (!user) {
      return res.status(404).json({
        error: {
          code: "RESOURCE_NOT_FOUND",
          message: "User not found",
        },
      });
    }

    res.json({
      data: {
        message: "User deleted successfully",
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
