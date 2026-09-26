function requireAdmin(req, res, next) {
  const key =
    req.headers['x-admin-key'] ||
    req.query.adminKey ||
    (req.body && req.body.adminKey);

  if (!process.env.ADMIN_DASHBOARD_KEY) {
    return res.status(503).json({
      status: false,
      message: 'ADMIN_DASHBOARD_KEY not configured'
    });
  }

  if (!key || key !== process.env.ADMIN_DASHBOARD_KEY) {
    return res.status(401).json({
      status: false,
      message: 'Unauthorized'
    });
  }

  next();
}

module.exports = { requireAdmin };