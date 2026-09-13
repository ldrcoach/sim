const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    // TLS mode (e.g. sslmode=require) comes from DATABASE_URL itself, which
    // gives us certificate verification against Node's trusted CA store.
    // Do not override it with a `ssl: { rejectUnauthorized: false }` object --
    // that disables certificate verification entirely.
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
  }
  return pool;
}

function isAvailable() {
  return !!getPool();
}

async function initSchema() {
  const p = getPool();
  if (!p) {
    console.log('[DB] No DATABASE_URL set -- database features disabled');
    return false;
  }

  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS sim_sessions (
        id SERIAL PRIMARY KEY,
        student_id VARCHAR(128),
        scenario_key VARCHAR(64) NOT NULL,
        mode VARCHAR(16) NOT NULL CHECK (mode IN ('sim', 'obs')),
        started_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS sim_scores (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES sim_sessions(id) ON DELETE CASCADE,
        dimension VARCHAR(64) NOT NULL,
        score INTEGER CHECK (score BETWEEN 1 AND 3),
        feedback TEXT
      );

      CREATE TABLE IF NOT EXISTS sim_transcripts (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES sim_sessions(id) ON DELETE CASCADE,
        role VARCHAR(16) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_student ON sim_sessions(student_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_scenario ON sim_sessions(scenario_key);
      CREATE INDEX IF NOT EXISTS idx_scores_session ON sim_scores(session_id);
      CREATE INDEX IF NOT EXISTS idx_transcripts_session ON sim_transcripts(session_id);
    `);
    console.log('[DB] Schema initialized');
    return true;
  } catch (err) {
    console.error('[DB] Schema init failed:', err.message);
    return false;
  }
}

// Allow tests to inject a mock pool
function setPool(mockPool) {
  pool = mockPool;
}

module.exports = { getPool, isAvailable, initSchema, setPool };
