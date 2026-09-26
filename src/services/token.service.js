// src/services/token.service.js
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const TOKEN_FILE = path.join(__dirname, '../../data/tokens.json');

class TokenService {
  constructor() {
    this.tokens = null; // { jwtToken, refreshToken, feedToken, expiresAt, issuedAt }
    this._loadFromFile(); // Load tokens when server starts
  }

  // ==============================================================
  // Load tokens from disk
  // ==============================================================
  _loadFromFile() {
    try {
      if (fs.existsSync(TOKEN_FILE)) {
        const raw = fs.readFileSync(TOKEN_FILE, 'utf8');
        const data = JSON.parse(raw);

        // Convert date strings back to Date objects
        if (data.expiresAt) data.expiresAt = new Date(data.expiresAt);
        if (data.issuedAt) data.issuedAt = new Date(data.issuedAt);

        this.tokens = data;
        console.log('📦 Tokens loaded from file. Expires at:', this.tokens.expiresAt?.toLocaleString());
      }
    } catch (err) {
      console.warn('Could not load tokens from file:', err.message);
      this.tokens = null;
    }
  }

  // ==============================================================
  // Save tokens to disk
  // ==============================================================
  _saveToFile() {
    try {
      fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
      fs.writeFileSync(TOKEN_FILE, JSON.stringify(this.tokens, null, 2));
    } catch (err) {
      console.error('Failed to save tokens to file:', err.message);
    }
  }

  // ==============================================================
  // Store tokens after successful login
  // ==============================================================
  storeTokens(jwtToken, refreshToken, feedToken) {
    try {
      const payload = jwt.decode(jwtToken);
      if (!payload || !payload.exp) {
        throw new Error('Invalid JWT: missing expiration');
      }

      this.tokens = {
        jwtToken,
        refreshToken,
        feedToken,
        expiresAt: new Date(payload.exp * 1000),
        issuedAt: new Date()
      };

      this._saveToFile();
      console.log('✅ Tokens stored. Expires at:', this.tokens.expiresAt.toLocaleString());
    } catch (err) {
      console.error('❌ Error storing tokens:', err.message);
      this.clearTokens();
      throw err;
    }
  }

  // ==============================================================
  // Update tokens after refresh
  // ==============================================================
  updateTokens(jwtToken, refreshToken, feedToken) {
    const payload = jwt.decode(jwtToken);
    if (!payload?.exp) {
      throw new Error('Invalid refreshed JWT');
    }

    this.tokens = {
      jwtToken,
      refreshToken,
      feedToken,
      expiresAt: new Date(payload.exp * 1000),
      issuedAt: new Date()
    };

    this._saveToFile();
    console.log('🔄 Tokens refreshed. New expiry:', this.tokens.expiresAt.toLocaleString());
  }

  // ==============================================================
  // Check if we have a valid token (> 5 minutes remaining)
  // ==============================================================
  hasValidToken() {
    if (!this.tokens?.jwtToken) return false;

    const timeRemaining = this.tokens.expiresAt.getTime() - Date.now();
    const fiveMinutes = 5 * 60 * 1000;

    return timeRemaining > fiveMinutes;
  }

  // ==============================================================
  // Get a valid JWT (auto-refresh if needed)
  // ==============================================================
  async getValidToken() {
    if (this.hasValidToken()) {
    return this.tokens.jwtToken;
  }

  if (!this.tokens?.refreshToken) {
    throw new Error('No refresh token available. Please login again.');
  }

  console.log('🔄 Token expired or expiring soon. Refreshing...');

  try {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-UserType': 'USER',
      'X-SourceID': 'WEB',
      'X-ClientLocalIP': '127.0.0.1',
      'X-ClientPublicIP': '127.0.0.1',
      'X-MACAddress': '00:00:00:00:00:00',
      'X-PrivateKey': process.env.ANGEL_API_KEY
    };
    if (this.tokens.jwtToken) {
      headers.Authorization = `Bearer ${this.tokens.jwtToken}`;
    }

    const response = await axios.post(
      'https://apiconnect.angelone.in/rest/auth/angelbroking/jwt/v1/generateTokens',
      { refreshToken: this.tokens.refreshToken },
      { headers }
    );

    const data = response.data?.data;
    if (!data?.jwtToken || !data?.refreshToken) {
      throw new Error('Failed to refresh token');
    }

    this.updateTokens(data.jwtToken, data.refreshToken, data.feedToken);
    return this.tokens.jwtToken;
  } catch (err) {
    console.error('Refresh failed:', err.response?.data || err.message);
    // Do NOT clearTokens() on network blips — only clear on explicit invalid refresh
    const msg = err.response?.data?.message || err.message || '';
    if (/invalid|expired|login/i.test(msg)) {
      this.clearTokens();
    }
    throw new Error('Failed to refresh token. Please login again.');
  }
  }

  getAllTokens() {
    return this.tokens;
  }

  clearTokens() {
    this.tokens = null;
    try {
      if (fs.existsSync(TOKEN_FILE)) {
        fs.unlinkSync(TOKEN_FILE);
      }
    } catch (err) {
      // ignore
    }
    console.log('🔒 Tokens cleared');
  }
}

module.exports = new TokenService();