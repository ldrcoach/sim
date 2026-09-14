const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAdminToken } = require('./adminAuth');
const checkinDb = require('./db');
const { toCsv } = require('./csv');
const instrumentLoader = require('./instrumentLoader');
const courses = require('./courses');

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

router.post('/instruments/reload', (req, res) => {
  try {
    instrumentLoader.reload();
    res.json({ ok: true });
  } catch (err) {
    console.error('[Admin] instrument reload failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.delete('/participant', async (req, res) => {
  try {
    const { participant_id: participantId } = req.query;
    if (!participantId || typeof participantId !== 'string') {
      return res.status(400).json({ error: 'participant_id query parameter is required' });
    }
    const result = await checkinDb.deleteParticipant(participantId);
    console.log(`[Admin] deleted participant ${participantId}: ${result.responses_deleted} response(s), participant row ${result.participant_deleted ? 'removed' : 'not found'}`);
    res.json(result);
  } catch (err) {
    console.error('[Admin] participant deletion failed:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

router.post('/purge-expired', async (req, res) => {
  try {
    const configs = courses.getAllCourseConfigs();
    const now = new Date();
    const results = [];
    for (const [course, cfg] of Object.entries(configs)) {
      const threshold = new Date(cfg.course_end_date);
      threshold.setDate(threshold.getDate() + cfg.retention_days_after_end);
      if (now < threshold) {
        results.push({ course, purged: 0, threshold: threshold.toISOString(), status: 'not yet due' });
        continue;
      }
      try {
        const ids = await checkinDb.findParticipantIdsWithEmailByCourse(course);
        const purged = await checkinDb.purgeParticipantEmails(ids);
        results.push({ course, purged, threshold: threshold.toISOString(), status: 'purged' });
      } catch (err) {
        // Per-course isolation: a DB failure purging one course must not abort
        // the rest of the loop, and must not leak infrastructure details (same
        // reasoning as the route-level catches below) into a response that a
        // course-developer-facing caller could see.
        console.error(`[Admin] purge-expired failed for course ${course}:`, err.message);
        results.push({ course, purged: 0, threshold: threshold.toISOString(), status: 'error', error: 'Internal error' });
      }
    }

    // Courses that have real submitted data but no courses.json entry never
    // appear in the loop above (getAllCourseConfigs only knows about
    // configured courses), so they'd otherwise have no automatic retention
    // path at all -- surface them here so an admin can see the gap and act
    // on it (add a courses.json entry, or purge manually via DELETE
    // /api/admin/participant), rather than the gap being invisible.
    const coursesWithData = await checkinDb.findDistinctCoursesWithParticipantData();
    const unconfigured = coursesWithData.filter((course) => !(course in configs));
    for (const course of unconfigured) {
      results.push({ course, purged: 0, threshold: null, status: 'unconfigured' });
    }

    console.log(`[Admin] purge-expired: ${results.map((r) => `${r.course}=${r.status}(${r.purged})`).join(', ')}`);
    res.json({ results });
  } catch (err) {
    console.error('[Admin] purge-expired failed:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
