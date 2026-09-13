const crypto = require('crypto');

function requireAdminToken(req, res, next) {
  const expected = process.env.CHECKIN_ADMIN_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: 'Admin API not configured' });
  }
  const provided = req.get('X-Admin-Token');
  if (
    typeof provided !== 'string' ||
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  ) {
    return res.status(401).json({ error: 'Invalid or missing admin token' });
  }
  next();
}

module.exports = { requireAdminToken };
