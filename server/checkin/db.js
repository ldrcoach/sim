const { getPool, isAvailable } = require('../db');

async function initCheckinSchema() {
  const p = getPool();
  if (!p) {
    console.log('[CheckIn DB] No DATABASE_URL set -- check-in persistence disabled');
    return false;
  }

  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS checkin_instruments (
        course VARCHAR(32) NOT NULL,
        module INTEGER NOT NULL,
        phase VARCHAR(16) NOT NULL CHECK (phase IN ('baseline', 'debrief')),
        version VARCHAR(32) NOT NULL,
        json JSONB NOT NULL,
        loaded_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (course, module, phase)
      );

      CREATE TABLE IF NOT EXISTS checkin_participants (
        participant_id VARCHAR(80) PRIMARY KEY,
        email_encrypted TEXT,
        identity_mode VARCHAR(16) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS checkin_responses (
        id SERIAL PRIMARY KEY,
        course VARCHAR(32) NOT NULL,
        module INTEGER NOT NULL,
        phase VARCHAR(16) NOT NULL CHECK (phase IN ('baseline', 'debrief')),
        participant_id VARCHAR(80) NOT NULL REFERENCES checkin_participants(participant_id),
        instrument_version VARCHAR(32) NOT NULL,
        started_at TIMESTAMPTZ NOT NULL,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        straightline_flag BOOLEAN NOT NULL DEFAULT FALSE,
        supersedes INTEGER REFERENCES checkin_responses(id),
        completion_code VARCHAR(32) NOT NULL UNIQUE,
        items_json JSONB NOT NULL,
        extras_json JSONB
      );

      CREATE TABLE IF NOT EXISTS checkin_response_items (
        response_id INTEGER NOT NULL REFERENCES checkin_responses(id) ON DELETE CASCADE,
        item_id VARCHAR(32) NOT NULL,
        raw_value INTEGER NOT NULL,
        scored_value INTEGER NOT NULL,
        UNIQUE (response_id, item_id)
      );

      CREATE TABLE IF NOT EXISTS checkin_subscale_scores (
        response_id INTEGER NOT NULL REFERENCES checkin_responses(id) ON DELETE CASCADE,
        subscale_id VARCHAR(32) NOT NULL,
        mean NUMERIC(4,2) NOT NULL,
        n_items INTEGER NOT NULL,
        UNIQUE (response_id, subscale_id)
      );

      CREATE INDEX IF NOT EXISTS idx_checkin_responses_participant
        ON checkin_responses(participant_id, course, module, phase);
      CREATE INDEX IF NOT EXISTS idx_checkin_response_items_response
        ON checkin_response_items(response_id);
      CREATE INDEX IF NOT EXISTS idx_checkin_subscale_scores_response
        ON checkin_subscale_scores(response_id);
    `);
    console.log('[CheckIn DB] Schema initialized');
    return true;
  } catch (err) {
    console.error('[CheckIn DB] Schema init failed:', err.message);
    return false;
  }
}

async function upsertParticipant(participantId, emailEncrypted, identityMode) {
  const p = getPool();
  await p.query(
    `INSERT INTO checkin_participants (participant_id, email_encrypted, identity_mode)
     VALUES ($1, $2, $3)
     ON CONFLICT (participant_id) DO NOTHING`,
    [participantId, emailEncrypted, identityMode]
  );
}

async function findLatestResponseId(participantId, course, moduleNum, phase) {
  const p = getPool();
  const result = await p.query(
    `SELECT id FROM checkin_responses
     WHERE participant_id = $1 AND course = $2 AND module = $3 AND phase = $4
     ORDER BY submitted_at DESC, id DESC LIMIT 1`,
    [participantId, course, moduleNum, phase]
  );
  return result.rows.length ? result.rows[0].id : null;
}

async function insertResponse({
  course, module: moduleNum, phase, participantId, instrumentVersion,
  startedAt, straightlineFlag, supersedes, completionCode,
  itemsJson, extrasJson, scoredItems, subscaleScores,
}) {
  const p = getPool();
  const result = await p.query(
    `INSERT INTO checkin_responses
       (course, module, phase, participant_id, instrument_version, started_at,
        straightline_flag, supersedes, completion_code, items_json, extras_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, submitted_at`,
    [
      course, moduleNum, phase, participantId, instrumentVersion, startedAt,
      straightlineFlag, supersedes, completionCode, JSON.stringify(itemsJson),
      extrasJson ? JSON.stringify(extrasJson) : null,
    ]
  );
  const responseId = result.rows[0].id;

  for (const item of scoredItems) {
    await p.query(
      `INSERT INTO checkin_response_items (response_id, item_id, raw_value, scored_value)
       VALUES ($1, $2, $3, $4)`,
      [responseId, item.item_id, item.raw_value, item.scored_value]
    );
  }

  for (const s of subscaleScores) {
    await p.query(
      `INSERT INTO checkin_subscale_scores (response_id, subscale_id, mean, n_items)
       VALUES ($1, $2, $3, $4)`,
      [responseId, s.subscale_id, s.mean, s.n_items]
    );
  }

  return { id: responseId, submitted_at: result.rows[0].submitted_at };
}

async function recordInstrumentVersion(course, moduleNum, phase, version, json) {
  const p = getPool();
  if (!p) return false;
  await p.query(
    `INSERT INTO checkin_instruments (course, module, phase, version, json)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (course, module, phase) DO UPDATE
       SET version = EXCLUDED.version, json = EXCLUDED.json, loaded_at = NOW()`,
    [course, moduleNum, phase, version, JSON.stringify(json)]
  );
  return true;
}

async function findParticipantIdsWithEmailByCourse(course) {
  const p = getPool();
  const result = await p.query(
    `SELECT DISTINCT cp.participant_id
     FROM checkin_participants cp
     JOIN checkin_responses cr ON cr.participant_id = cp.participant_id
     WHERE cr.course = $1 AND cp.email_encrypted IS NOT NULL`,
    [course]
  );
  return result.rows.map((r) => r.participant_id);
}

async function purgeParticipantEmails(participantIds) {
  if (participantIds.length === 0) return 0;
  const p = getPool();
  const result = await p.query(
    `UPDATE checkin_participants SET email_encrypted = NULL WHERE participant_id = ANY($1::varchar[])`,
    [participantIds]
  );
  return result.rowCount;
}

module.exports = {
  isAvailable,
  initCheckinSchema,
  upsertParticipant,
  findLatestResponseId,
  insertResponse,
  recordInstrumentVersion,
  findParticipantIdsWithEmailByCourse,
  purgeParticipantEmails,
};
