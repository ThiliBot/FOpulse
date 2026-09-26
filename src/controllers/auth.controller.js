// src/controllers/auth.controller.js
const axios = require('axios');
const tokenService = require('../services/token.service');

const ANGEL_LOGIN_URL = 'https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword';
const ANGEL_REFRESH_URL = 'https://apiconnect.angelone.in/rest/auth/angelbroking/jwt/v1/generateTokens';
const ANGEL_LOGOUT_URL = 'https://apiconnect.angelone.in/rest/secure/angelbroking/user/v1/logout';
const ANGEL_PROFILE_URL = 'https://apiconnect.angelone.in/rest/secure/angelbroking/user/v1/getProfile';

function getAngelHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-UserType': 'USER',
    'X-SourceID': 'WEB',
    'X-ClientLocalIP': '127.0.0.1',
    'X-ClientPublicIP': '127.0.0.1',
    'X-MACAddress': '00:00:00:00:00:00',
    'X-PrivateKey': process.env.ANGEL_API_KEY,
  };
}

/**
 * POST /api/login
 */
async function login(req, res) {
  try {
    const clientcode = process.env.ANGEL_CLIENT_ID;
    const password = process.env.ANGEL_PASSWORD;
    const totp = req.body.totp;

    if (!clientcode || !password || !totp) {
      return res.status(400).json({
        status: false,
        message: 'clientcode, password and totp are required'
      });
    }

    const response = await axios.post(
      ANGEL_LOGIN_URL,
      { clientcode, password, totp },
      { headers: getAngelHeaders() }
    );

    const result = response.data;
    const tokenData = result.data || result;

    if (!tokenData.jwtToken || !tokenData.refreshToken) {
      return res.status(401).json({
        status: false,
        message: result.message || 'Login failed'
      });
    }

    tokenService.storeTokens(
      tokenData.jwtToken,
      tokenData.refreshToken,
      tokenData.feedToken
    );

    return res.json({
      status: true,
      message: 'Login successful',
      data: {
        jwtToken: tokenData.jwtToken,
        refreshToken: tokenData.refreshToken,
        feedToken: tokenData.feedToken
      }
    });
  } catch (err) {
    console.error('Login error:', err.response?.data || err.message);
    return res.status(err.response?.status || 500).json({
      status: false,
      message: err.response?.data?.message || 'Login failed'
    });
  }
}

/**
 * POST /api/refresh
 */
async function refresh(req, res) {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        status: false,
        message: 'refreshToken is required'
      });
    }

    const response = await axios.post(
      ANGEL_REFRESH_URL,
      { refreshToken },
      { headers: getAngelHeaders() }
    );

    const tokenData = response.data?.data || response.data;

    if (!tokenData.jwtToken || !tokenData.refreshToken) {
      return res.status(401).json({
        status: false,
        message: 'Invalid refresh token'
      });
    }

    tokenService.updateTokens(
      tokenData.jwtToken,
      tokenData.refreshToken,
      tokenData.feedToken
    );

    return res.json({
      status: true,
      message: 'Tokens refreshed',
      data: {
        jwtToken: tokenData.jwtToken,
        refreshToken: tokenData.refreshToken,
        feedToken: tokenData.feedToken
      }
    });
  } catch (err) {
    console.error('Refresh error:', err.response?.data || err.message);
    return res.status(err.response?.status || 500).json({
      status: false,
      message: err.response?.data?.message || 'Refresh failed'
    });
  }
}

/**
 * GET /api/status
 */
async function getStatus(req, res) {
  try {
    const tokens = tokenService.getAllTokens();

    if (!tokens) {
      return res.json({
        status: true,
        valid: false,
        message: 'No active session'
      });
    }

    const remainingMs = tokens.expiresAt.getTime() - Date.now();
    const remainingSeconds = Math.max(0, Math.round(remainingMs / 1000));

    return res.json({
      status: true,
      valid: tokenService.hasValidToken(),
      expiresAt: tokens.expiresAt,
      remainingSeconds,
      minutesRemaining: Number((remainingSeconds / 60).toFixed(2))
    });
  } catch (err) {
    return res.status(500).json({
      status: false,
      message: 'Status check failed'
    });
  }
}

/**
 * GET /api/profile   ← NEW
 */
async function getProfile(req, res) {
  try {
    const jwtToken = await tokenService.getValidToken();

    const response = await axios.get(ANGEL_PROFILE_URL, {
      headers: getAngelHeaders({
        Authorization: `Bearer ${jwtToken}`
      })
    });

    return res.json({
      status: true,
      message: 'Profile fetched successfully',
      data: response.data?.data || response.data
    });
  } catch (err) {
    console.error('Profile error:', err.response?.data || err.message);
    return res.status(err.response?.status || 500).json({
      status: false,
      message: err.response?.data?.message || 'Failed to fetch profile'
    });
  }
}

/**
 * POST /api/logout
 */
async function logout(req, res) {
  try {
    const tokens = tokenService.getAllTokens();

    if (tokens?.jwtToken) {
      try {
        await axios.post(
          ANGEL_LOGOUT_URL,
          { clientcode: process.env.ANGEL_CLIENT_CODE || '' },
          {
            headers: getAngelHeaders({
              Authorization: `Bearer ${tokens.jwtToken}`
            })
          }
        );
      } catch (err) {
        console.warn('Angel logout API failed (ignored):', err.message);
      }
    }

    tokenService.clearTokens();

    return res.json({
      status: true,
      message: 'Logged out successfully'
    });
  } catch (err) {
    return res.status(500).json({
      status: false,
      message: 'Logout failed'
    });
  }
}

module.exports = {
  login,
  refresh,
  getStatus,
  getProfile,
  logout
};