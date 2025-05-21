const rateLimit = require('express-rate-limit');

// Global rate limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: {
      code: 'RATE_LIMIT_ERROR',
      message: 'Too many requests from this IP, please try again later.'
    }
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  skipFailedRequests: false, // Don't skip failed requests (count them towards limit)
  skipSuccessfulRequests: false, // Don't skip successful requests (count them towards limit)
  trustProxy: true // Trust the X-Forwarded-For header for IP
});

// Auth endpoints rate limiter (more strict)
const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 requests per windowMs
  message: {
    error: {
      code: 'RATE_LIMIT_ERROR',
      message: 'Too many authentication attempts, please try again later.'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: false,
  skipSuccessfulRequests: false,
  trustProxy: true
});

// Username validation rate limiter
const usernameLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // Limit each IP to 20 requests per windowMs
  message: {
    error: {
      code: 'RATE_LIMIT_ERROR',
      message: 'Too many username validation attempts, please try again later.'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: false,
  skipSuccessfulRequests: false,
  trustProxy: true
});

// Export limiters with try-catch wrapper
const wrapLimiter = (limiter) => {
  return async (req, res, next) => {
    try {
      await limiter(req, res, next);
    } catch (error) {
      console.error('Rate limiter error:', error);
      // Continue without rate limiting in case of errors
      next();
    }
  };
};

module.exports = {
  globalLimiter: wrapLimiter(globalLimiter),
  authLimiter: wrapLimiter(authLimiter),
  usernameLimiter: wrapLimiter(usernameLimiter)
}; 