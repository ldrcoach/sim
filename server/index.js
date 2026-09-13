const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const { getPool, isAvailable, initSchema } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

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

// SPA fallback - serve index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

// Only start listening when run directly (not when imported by tests)
if (require.main === module) {
  initSchema().then(() => {
    app.listen(PORT, () => {
      console.log(`OBLD 500 Simulation Suite running on port ${PORT}`);
    });
  });
}

module.exports = app;
