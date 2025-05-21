const express = require("express");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const { User, ROLES } = require("../models/user.model");
const { authLimiter } = require("../middleware/rateLimit");

const router = express.Router();

// Helper function to verify token
const verifyToken = async (token) => {
  try {
    if (!token || !token.startsWith("Bearer ")) {
      return null;
    }

    const decoded = jwt.verify(
      token.replace("Bearer ", ""),
      process.env.JWT_SECRET
    );
    const user = await User.findById(decoded.userId);
    return user;
  } catch (error) {
    return null;
  }
};

// Validation middleware
const validateSignup = [
  body("email").isEmail().normalizeEmail(),
  body("password")
    .isLength({ min: 8 })
    .matches(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/
    ),
  body("username")
    .isLength({ min: 3 })
    .matches(/^[a-zA-Z0-9_-]+$/),
  body("fullName").optional().trim().escape(),
  body("role").optional(),
];

const validateLogin = [
  body("email").isEmail().normalizeEmail(),
  body("password").notEmpty(),
];

// Signup route
router.post("/signup", authLimiter, validateSignup, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid input data",
          details: errors.array(),
        },
      });
    }

    const { email, password, username, fullName } = req.body;

    // Check if email exists
    const existingEmail = await User.findByEmail(email);
    if (existingEmail) {
      return res.status(400).json({
        error: {
          code: "DUPLICATE_ERROR",
          message: "Email already exists",
        },
      });
    }

    // Check if username exists
    const existingUsername = await User.findByUsername(username);
    if (existingUsername) {
      return res.status(400).json({
        error: {
          code: "DUPLICATE_ERROR",
          message: "Username already exists",
        },
      });
    }

    const userCount = await User.countDocuments();
    let role = ROLES.VIEWER;

    if (userCount === 0) {
      role = ROLES.ADMIN;
    } else {
      const authHeader = req.header("Authorization");
      if (authHeader) {
        const adminUser = await verifyToken(authHeader);
        if (adminUser && adminUser.role === ROLES.ADMIN) {
          role = req.body.role?.toLowerCase().includes("editor")
            ? ROLES.EDITOR
            : req.body.role?.toLowerCase().includes("viewer")
            ? ROLES.VIEWER
            : ROLES.VIEWER;
        }
      }
    }

    // Create new user
    const user = new User({
      email,
      password,
      username,
      fullName,
      role,
    });

    await user.save();

    // Generate JWT token
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRATION || "24h",
    });

    res.status(201).json({
      data: {
        user,
        token,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Login route
router.post("/login", authLimiter, validateLogin, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid input data",
          details: errors.array(),
        },
      });
    }

    const { email, password } = req.body;

    // Find user by email
    const user = await User.findByEmail(email);
    if (!user) {
      return res.status(401).json({
        error: {
          code: "AUTHENTICATION_ERROR",
          message: "Invalid email or password",
        },
      });
    }

    // Check password
    const isValidPassword = await user.comparePassword(password);
    if (!isValidPassword) {
      return res.status(401).json({
        error: {
          code: "AUTHENTICATION_ERROR",
          message: "Invalid email or password",
        },
      });
    }

    // Generate JWT token
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRATION || "24h",
    });

    res.json({
      data: {
        user,
        token,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
