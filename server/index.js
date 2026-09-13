const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const { getPool, isAvailable, initSchema } = require('./db');
const checkinRoutes = require('./checkin/routes');
const instrumentLoader = require('./checkin/instrumentLoader');
const checkinDb = require('./checkin/db');

const app = express();
const PORT = process.env.PORT || 3000;

// Azure Container Apps ingress sits in front of us as a single reverse proxy
// hop; trust its X-Forwarded-For so express-rate-limit keys on the real
// client IP instead of the proxy's.
app.set('trust proxy', 1);

app.use('/api', checkinRoutes);

app.use(express.json({ limit: '1mb' }));

// General rate limit: 100 requests per 15 minutes per IP
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait before trying again.' },
});
app.use(generalLimiter);

// Strict rate limit for chat endpoint: 20 requests per 15 minutes per IP
const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait before sending another message.' },
});

// Serve static React build
app.use(express.static(path.join(__dirname, '../client/dist')));

// API proxy - keeps Anthropic key server-side
app.post('/api/chat', chatLimiter, async (req, res) => {
  const { system, messages, max_tokens = 1000 } = req.body;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.MODEL || 'claude-sonnet-5',
        max_tokens,
        system,
        messages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Anthropic API error (${response.status}):`, errText);
      return res.status(response.status).json({ error: `API error: ${response.status}` });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(500).json({ error: 'Internal proxy error' });
  }
});

// Log usage (simple console logging; replace with DB later if needed)
app.post('/api/log', (req, res) => {
  const { event, suite, scenario, timestamp } = req.body;
  console.log(`[USAGE] ${timestamp || new Date().toISOString()} | ${event} | ${suite} | ${scenario}`);
  res.json({ ok: true });
});

// --- Database endpoints (require DATABASE_URL) ---

// Middleware: check DB availability
function requireDb(req, res, next) {
  if (!isAvailable()) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  next();
}

// POST /api/sessions -- create a new session
app.post('/api/sessions', requireDb, async (req, res) => {
  try {
    const { student_id, scenario_key, mode } = req.body;
    if (!scenario_key || !mode) {
      return res.status(400).json({ error: 'scenario_key and mode required' });
    }
    const result = await getPool().query(
      'INSERT INTO sim_sessions (student_id, scenario_key, mode) VALUES ($1, $2, $3) RETURNING id, started_at',
      [student_id || null, scenario_key, mode]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sessions/:id/scores -- save rubric scores
app.post('/api/sessions/:id/scores', requireDb, async (req, res) => {
  try {
    const { scores } = req.body;
    if (!Array.isArray(scores)) {
      return res.status(400).json({ error: 'scores array required' });
    }
    const pool = getPool();
    for (const s of scores) {
      await pool.query(
        'INSERT INTO sim_scores (session_id, dimension, score, feedback) VALUES ($1, $2, $3, $4)',
        [req.params.id, s.dimension, s.score, s.feedback || null]
      );
    }
    await pool.query('UPDATE sim_sessions SET completed_at = NOW() WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sessions/:id/transcript -- save conversation messages
app.post('/api/sessions/:id/transcript', requireDb, async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array required' });
    }
    const pool = getPool();
    for (const m of messages) {
      await pool.query(
        'INSERT INTO sim_transcripts (session_id, role, content) VALUES ($1, $2, $3)',
        [req.params.id, m.role, m.content]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/students/:id/history -- get student's session history
app.get('/api/students/:id/history', requireDb, async (req, res) => {
  try {
    const sessions = await getPool().query(
      `SELECT s.id, s.scenario_key, s.mode, s.started_at, s.completed_at,
              json_agg(json_build_object('dimension', sc.dimension, 'score', sc.score, 'feedback', sc.feedback)) AS scores
       FROM sim_sessions s
       LEFT JOIN sim_scores sc ON sc.session_id = s.id
       WHERE s.student_id = $1
       GROUP BY s.id ORDER BY s.started_at DESC`,
      [req.params.id]
    );
    res.json(sessions.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Privacy statement page
app.get('/privacy', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Privacy Statement - OBLD 500 Check-In</title>
  <style>
    body { font-family: 'Segoe UI', -apple-system, sans-serif; max-width: 700px; margin: 40px auto; padding: 0 20px; line-height: 1.6; color: #1a1a1a; }
    h1 { color: #0a1628; }
    h2 { color: #0a1628; font-size: 18px; margin-top: 28px; }
  </style>
</head>
<body>
  <h1>Privacy Statement</h1>
  <p>This page explains what happens to your responses when you complete a
  Baseline Check or Debrief in the OBLD 500 check-in module, administered by
  LDRC.</p>

  <h2>What is collected</h2>
  <p>Your ERAU email address, your answers to the questionnaire items, and,
  on the Debrief, your written reflections. We do not collect your IP
  address, browser information, or any Canvas identifiers.</p>

  <h2>Why</h2>
  <p>Your email is used only to match your Baseline and Debrief responses
  for the same module, so your instructor can see how your self-assessed
  skills changed over the module. It is stored encrypted and separately
  from your answers.</p>

  <h2>Who can see it</h2>
  <p>Your course developer can see your responses in identifiable form for
  course measurement. In aggregate (combined across the whole class,
  without names), your responses may also be reported to ERAU. Your
  responses are not part of your grade.</p>

  <h2>How long</h2>
  <p>Your email is kept only for the duration of the course, then deleted.
  Your questionnaire responses (not tied to your name after that point) are
  kept for course improvement purposes.</p>

  <h2>How to ask for deletion</h2>
  <p>Email your course developer at any time to ask that your responses be
  deleted. Any use of your data for research beyond course measurement
  would require separate IRB-approved consent, which this page does not
  cover.</p>
</body>
</html>`);
});

// SPA fallback - serve index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

// Only start listening when run directly (not when imported by tests)
if (require.main === module) {
  try {
    instrumentLoader.load();
    console.log('[CheckIn] Instruments loaded and validated');
  } catch (err) {
    // Do not process.exit here: a bad instrument JSON file should only take
    // down the check-in feature, not the whole app (chat, sessions, SPA).
    // Check-in's own routes will 500 per-request until this is fixed and
    // redeployed -- Express 4 catches the synchronous throw from a later
    // ensureLoaded() retry inside the route handler, so it degrades to a
    // per-request error rather than crashing the process.
    console.error('[CheckIn] Instrument validation failed at boot -- check-in endpoints will error until this is fixed and redeployed:', err.message);
  }

  Promise.all([initSchema(), checkinDb.initCheckinSchema()])
    .then(() => {
      app.listen(PORT, () => {
        console.log(`OBLD 500 Simulation Suite running on port ${PORT}`);
      });
    })
    .catch((err) => {
      console.error('[Boot] Unexpected error during startup:', err);
      process.exit(1);
    });
}

module.exports = app;
