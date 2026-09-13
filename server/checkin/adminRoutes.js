const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAdminToken } = require('./adminAuth');
const checkinDb = require('./db');

const router = express.Router();

// This router is mounted at its own dedicated prefix (/api/admin, see
// index.js) and every route in it needs the identical auth + rate limit
// treatment -- unlike the public checkin router (routes.js), where two
// different routes needed two different body-size/rate-limit rules and a
// bare router.use(fn) wrongly applied to requests that didn't match either
// one. There's no equivalent risk here: nothing else is mounted under
// /api/admin, so router-level middleware is the correct, simpler choice.
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait before trying again.' },
});
router.use(adminLimiter);
router.use(requireAdminToken);

function requireDb(req, res, next) {
  if (!checkinDb.isAvailable()) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  next();
}
router.use(requireDb);

router.get('/verify', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'code query parameter is required' });
    }
    const match = await checkinDb.findResponseByCompletionCode(code);
    if (!match) {
      return res.json({ valid: false });
    }
    res.json({
      valid: true,
      course: match.course,
      module: match.module,
      phase: match.phase,
      submitted_at: match.submitted_at,
    });
  } catch (err) {
    console.error('[Admin] verify lookup failed:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

router.get('/summary', async (req, res) => {
  try {
    const { course } = req.query;
    if (!course || typeof course !== 'string') {
      return res.status(400).json({ error: 'course query parameter is required' });
    }
    const summary = await checkinDb.getSummary(course);
    res.json({ course, summary });
  } catch (err) {
    console.error('[Admin] summary lookup failed:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
