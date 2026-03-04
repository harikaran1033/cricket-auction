/**
 * Centralized error handler middleware.
 */
module.exports = (err, req, res, _next) => {
  console.error(`[Error] ${err.message}`);

  const statusCode = err.statusCode || 400;
  res.status(statusCode).json({
    success: false,
    error: err.message || "Internal Server Error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
};
