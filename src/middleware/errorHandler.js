const errorHandler = (err, req, res, next) => {
  console.error(err.stack);

  // Handle validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation Error',
        details: Object.values(err.errors).map(error => ({
          field: error.path,
          message: error.message
        }))
      }
    });
  }

  // Handle MongoDB duplicate key errors
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    return res.status(400).json({
      error: {
        code: 'DUPLICATE_ERROR',
        message: `${field} already exists`
      }
    });
  }

  // Handle MongoDB cast errors
  if (err.name === 'CastError') {
    return res.status(400).json({
      error: {
        code: 'INVALID_ID',
        message: 'Invalid ID format'
      }
    });
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid token'
      }
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: {
        code: 'TOKEN_EXPIRED',
        message: 'Token expired'
      }
    });
  }

  // Handle MongoDB connection errors
  if (err.name === 'MongoNetworkError') {
    return res.status(503).json({
      error: {
        code: 'DATABASE_ERROR',
        message: 'Database connection error'
      }
    });
  }

  // Handle all other errors
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: process.env.NODE_ENV === 'production' 
        ? 'Something went wrong'
        : err.message
    }
  });
};

module.exports = errorHandler; 