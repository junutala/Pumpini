// src/middleware/errorHandler.js
const logger = require('../utils/logger');

const errorHandler = (err, req, res, _next) => {
  logger.error(err.message, { stack: err.stack, path: req.path });
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = { errorHandler };
