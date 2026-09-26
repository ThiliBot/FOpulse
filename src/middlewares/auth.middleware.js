// src/middlewares/auth.middleware.js
const tokenService = require('../services/token.service');

/**
 * Middleware that ensures we always have a valid JWT.
 * Automatically refreshes the token if needed.
 */
async function authenticate(req, res, next) {
  try {
    // Get a valid token (auto-refreshes if required)
    const jwtToken = await tokenService.getValidToken();

    // Attach token to request for downstream use
    req.jwtToken = jwtToken;
    req.tokens = tokenService.getAllTokens();

    next();
  } catch (err) {
    console.error('Auth middleware error:', err.message);
    return res.status(401).json({
      status: false,
      message: 'Session expired. Please login again.',
      error: err.message
    });
  }
}

module.exports = { authenticate };