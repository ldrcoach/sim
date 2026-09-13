const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAdminToken } = require('./adminAuth');
const checkinDb = require('./db');
const { toCsv } = require('./csv');

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

function pivotPaired(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = `${row.participant_id}|${row.module}|${row.subscale_id}`;
    if (!map.has(key)) {
      map.set(key, {
        participant_id: row.participant_id,
        module: row.module,
        subscale_id: row.subscale_id,
        baseline_mean: null,
        debrief_mean: null,
      });
    }
    const entry = map.get(key);
    if (row.phase === 'baseline') entry.baseline_mean = Number(row.mean);
    else entry.debrief_mean = Number(row.mean);
  }
  return Array.from(map.values()).map((entry) => ({
    ...entry,
    delta:
      entry.baseline_mean != null && entry.debrief_mean != null
        ? Math.round((entry.debrief_mean - entry.baseline_mean) * 100) / 100
        : null,
  }));
}

router.get('/export', async (req, res) => {
  try {
    const { course, format = 'json', shape = 'long' } = req.query;
    if (!course || typeof course !== 'string') {
      return res.status(400).json({ error: 'course query parameter is required' });
    }
    if (!['json', 'csv'].includes(format)) {
      return res.status(400).json({ error: 'format must be "json" or "csv"' });
    }
    if (!['long', 'paired'].includes(shape)) {
      return res.status(400).json({ error: 'shape must be "long" or "paired"' });
    }

    let rows;
    if (shape === 'long') {
      rows = await checkinDb.getExportLongRows(course);
    } else {
      rows = pivotPaired(await checkinDb.getExportPairedRows(course));
    }

    if (format === 'csv') {
      res.type('text/csv').send(toCsv(rows));
    } else {
      res.json({ course, shape, rows });
    }
  } catch (err) {
    console.error('[Admin] export failed:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
