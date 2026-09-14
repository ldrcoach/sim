const crypto = require('crypto');

function requireAdminToken(req, res, next) {
  const expected = process.env.CHECKIN_ADMIN_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: 'Admin API not configured' });
  }
  const provided = req.get('X-Admin-Token');
  if (typeof provided !== 'string') {
    return res.status(401).json({ error: 'Invalid or missing admin token' });
  }
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  // Both the byte-length pre-check AND timingSafeEqual (not a bare ===) are required:
  // timingSafeEqual throws if the buffers differ in byte length, and a plain ===
  // (or a naive char-by-char loop) would leak timing information about how many
  // leading bytes match, reopening the constant-time comparison this guards against.
  if (
    providedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, expectedBuf)
  ) {
    return res.status(401).json({ error: 'Invalid or missing admin token' });
  }
  next();
}

module.exports = { requireAdminToken };
