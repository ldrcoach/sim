# Check-In Module: Admin API, courses.json, Retention Purge, Then-and-Now Panel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build three of the six items deferred from the Check-In Module v0.1 plan (`docs/superpowers/plans/2026-09-13-checkin-module.md`, already merged): the admin API (verify/summary/export/reload/delete), `courses.json` + the identity-mode decision, the automatic retention purge job, and the "then and now" Baseline-vs-Debrief comparison panel. The real 18-Google-Forms instrument migration and CSP `frame-ancestors` remain out of scope, by explicit user choice.

**Architecture:** New `server/checkin/courses.js` (course config loader, same validate-and-load-with-full-error-list pattern as `instrumentLoader.js`), a new `server/checkin/adminRoutes.js` mounted at `/api/admin` with its own token-gated auth, and small additions to `server/checkin/db.js` and `server/checkin/routes.js`. Client-side, `ConfirmationScreen` gets a new panel when a Debrief response has a matching Baseline to compare against.

**Tech Stack:** Same as the base module -- Node/Express, `pg`, React. No new dependencies.

**Decisions already made by Dr. Watkins (2026-09-13), do not re-litigate:**
1. **Identity mode stays `email`** (already deployed, already correct). `courses.json` is still built with a full `identity_mode` field for future-proofing, but the code only implements `email` -- if a course is ever configured with `key`/`none`, the server rejects with 501 rather than silently mishandling it.
2. **The "then and now" panel is shown to learners** as soon as it's built (not held back).
3. **Retention purge triggers 90 days after course end.** Course end date for OBLD500's 2027.01 term, sourced from ERAU's official Worldwide & Online academic calendar (Graduate Online track, 2026-2027 calendar): **2027-03-14**. That makes the purge threshold **2027-06-12**.

---

## Source-spec deviations (read this before starting)

Same spirit as the base module's plan: correcting assumptions, not covering up mistakes.

1. **`courses.json` lives at `server/checkin/courses.json`**, not an unspecified repo-root location -- the original spec never pinned a path. This keeps it alongside `server/checkin/instruments/`, the other piece of check-in config data. Overridable via `CHECKIN_COURSES_FILE`, matching the `CHECKIN_INSTRUMENT_DIR` pattern already established.
2. **The admin router is mounted at `/api/admin`**, a distinct prefix from the public router's `/api`. This was a deliberate ordering choice, not an accident: `app.use('/api/admin', adminRoutes)` is registered *before* `app.use('/api', checkinRoutes)` in `server/index.js`, so admin requests never even reach the public router's route-matching logic. (They'd fall through safely either way now that `checkinRoutes` has no bare `router.use(fn)` middleware left after the base module's Task 9 fix -- but mounting the more specific path first is the clearer, safer convention, and there's no reason not to follow it.)
3. **`GET /api/admin/verify` is a plain database lookup by `completion_code`, not a cryptographic re-verification.** The already-built `completionCode.verifyCompletionCode()` function needs the *same* inputs (course/module/phase/participant_id/submitted_at) that were used to generate the code in the first place -- an admin calling this endpoint only has the code itself, not those inputs. A DB lookup (`WHERE completion_code = $1`) already fully satisfies the spec's acceptance criterion ("a code with one character changed does not verify" -- a tampered code simply won't match any row). Re-deriving and comparing against the code's own stored inputs would only guard against someone with direct database write access forging a row, which is a different threat model this endpoint isn't trying to cover, and it introduces real fragility (TIMESTAMPTZ round-trip precision matching the exact ISO string used at generation time). Simpler and more robust wins here.
4. **The retention purge only nulls `email_encrypted`, never deletes the participant row or their responses** -- this matches the original spec's own distinction between the automatic purge (keep `participant_id` and all response data for analysis, drop only the identifying email) and `DELETE /api/admin/participant` (a human-requested full erasure, which *does* delete responses too). Don't conflate the two when implementing either.
5. **Known simplification: retention is computed per-course, not per-cohort/term.** `checkin_responses.course` stores the bare course code (`"OBLD500"`), not a term-qualified one (`"OBLD500-2027-01"`) -- the schema has no term/cohort dimension at all. `courses.json`'s single `course_end_date` per course entry is meant to be updated by hand each term. If OBLD 500 ever runs two overlapping cohorts with different end dates, this design purges *all* of that course's participant emails at once, based on whatever's currently in `courses.json` -- there's no way today to purge one cohort's data while preserving another's. Fine for a single sequential course; would need a real schema change (adding a term/cohort column) if that assumption ever breaks. Flag this to Dr. Watkins if it becomes a real scheduling conflict rather than silently building around it.
6. **`email_domain_hint` and `allow_embed` are stored in `courses.json` but not acted on by any code in this plan.** The spec describes `email_domain_hint` as "used for a soft warning only" (a client-side, non-blocking UI hint) and `allow_embed` as gating the CSP `frame-ancestors` header for Canvas iframe embedding -- both are real, separately-scoped features explicitly not selected for this round. Building the config field now (rather than adding it later) costs nothing and means the file doesn't need reshaping when those features do land.
7. **No new npm dependencies.** CSV export is hand-rolled (the data is small, server-controlled, and simple enough that a dependency isn't justified); everything else reuses `express`, `pg`, and Node's built-in `crypto`.

---

## File Structure

```
server/
  checkin/
    courses.json              New: per-course config (identity mode, retention window, etc.)
    courses.js                 New: loads + validates courses.json, same fail-with-all-errors pattern as instrumentLoader.js
    adminAuth.js                New: X-Admin-Token middleware (timing-safe comparison)
    csv.js                      New: minimal CSV serialization (no injection risk -- server-controlled numeric/short-string data, still escapes commas/quotes/newlines)
    adminRoutes.js               New: GET /verify, GET /summary, GET /export, POST /instruments/reload, DELETE /participant, POST /purge-expired
    db.js                        MODIFY: add findParticipantIdsWithEmailByCourse, purgeParticipantEmails,
                                  findResponseByCompletionCode, getSummary, getExportLongRows, getExportPairedRows,
                                  deleteParticipant, findLatestSubscaleScores
    routes.js                    MODIFY: read identity_mode from courses.json (reject non-"email" modes with 501),
                                  include baseline_comparison in POST /responses for debrief submissions
  index.js                      MODIFY: mount adminRoutes at /api/admin, load courses.json at boot (same loud-but-non-fatal pattern as instruments)
  tests/
    checkin.courses.test.js      New
    checkin.adminAuth.test.js     New
    checkin.csv.test.js            New
    checkin.adminRoutes.test.js     New
    checkin.db.test.js               MODIFY: append tests for the 7 new db.js functions
    checkin.routes.test.js            MODIFY: mock ../checkin/courses, add identity-mode-rejection and baseline_comparison tests
client/
  src/
    CheckIn.jsx                MODIFY: add ThenAndNowPanel, wire into ConfirmationScreen when result.baseline_comparison is present
.env.example, README.md, CLAUDE.md    MODIFY: document CHECKIN_ADMIN_TOKEN, CHECKIN_COURSES_FILE, the admin endpoints, courses.json
```

---

### Task 1: courses.json and its loader

**Files:**
- Create: `server/checkin/courses.json`
- Create: `server/checkin/courses.js`
- Test: `server/tests/checkin.courses.test.js`

- [ ] **Step 1: Write the fixture config**

Create `server/checkin/courses.json`:

```json
{
  "OBLD500": {
    "course_code": "OBLD500-2027-01",
    "identity_mode": "email",
    "email_domain_hint": "erau.edu",
    "course_end_date": "2027-03-14",
    "retention_days_after_end": 90,
    "allow_embed": true
  }
}
```

This is real configuration, not a fixture like `AL.json` was -- `course_end_date` is sourced from ERAU's official Worldwide & Online academic calendar (Graduate Online track) for the January 2027 ("2027.01") term.

- [ ] **Step 2: Write the failing tests**

Create `server/tests/checkin.courses.test.js`:

```javascript
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('courses.js', () => {
  let courses;
  let tmpDir;

  beforeEach(() => {
    jest.resetModules();
    courses = require('../checkin/courses');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-courses-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('loads the real courses.json and serves the OBLD500 entry', () => {
    courses.load(path.join(__dirname, '..', 'checkin', 'courses.json'));
    const cfg = courses.getCourseConfig('OBLD500');
    expect(cfg).not.toBeNull();
    expect(cfg.identity_mode).toBe('email');
    expect(cfg.course_end_date).toBe('2027-03-14');
    expect(cfg.retention_days_after_end).toBe(90);
  });

  test('getCourseConfig returns null for an unknown course', () => {
    courses.load(path.join(__dirname, '..', 'checkin', 'courses.json'));
    expect(courses.getCourseConfig('NOTACOURSE')).toBeNull();
  });

  test('getAllCourseConfigs returns the full config object', () => {
    courses.load(path.join(__dirname, '..', 'checkin', 'courses.json'));
    const all = courses.getAllCourseConfigs();
    expect(Object.keys(all)).toContain('OBLD500');
  });

  test('throws with all validation errors when a course entry is missing required fields', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'bad.json'),
      JSON.stringify({ BADCOURSE: { course_code: 'X' } })
    );
    expect(() => courses.load(path.join(tmpDir, 'bad.json'))).toThrow(/identity_mode/);
  });

  test('throws when course_end_date is not a parseable date', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'bad-date.json'),
      JSON.stringify({
        X: {
          course_code: 'X-2027',
          identity_mode: 'email',
          email_domain_hint: 'example.edu',
          course_end_date: 'not-a-date',
          retention_days_after_end: 90,
          allow_embed: true,
        },
      })
    );
    expect(() => courses.load(path.join(tmpDir, 'bad-date.json'))).toThrow(/course_end_date/);
  });

  test('throws when retention_days_after_end is not a non-negative integer', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'bad-retention.json'),
      JSON.stringify({
        X: {
          course_code: 'X-2027',
          identity_mode: 'email',
          email_domain_hint: 'example.edu',
          course_end_date: '2027-01-01',
          retention_days_after_end: -5,
          allow_embed: true,
        },
      })
    );
    expect(() => courses.load(path.join(tmpDir, 'bad-retention.json'))).toThrow(/retention_days_after_end/);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd server && npx jest tests/checkin.courses.test.js`
Expected: FAIL with `Cannot find module '../checkin/courses'`

- [ ] **Step 4: Write the implementation**

Create `server/checkin/courses.js`:

```javascript
const fs = require('fs');
const path = require('path');

const DEFAULT_PATH = path.join(__dirname, 'courses.json');

let config = null;

function validateCourseConfig(course, cfg) {
  const errors = [];
  if (!cfg || typeof cfg !== 'object') {
    return [`${course}: config must be an object`];
  }
  if (!cfg.course_code || typeof cfg.course_code !== 'string') {
    errors.push(`${course}.course_code is required and must be a string`);
  }
  if (!cfg.identity_mode || typeof cfg.identity_mode !== 'string') {
    errors.push(`${course}.identity_mode is required and must be a string`);
  }
  if (!cfg.email_domain_hint || typeof cfg.email_domain_hint !== 'string') {
    errors.push(`${course}.email_domain_hint is required and must be a string`);
  }
  if (!cfg.course_end_date || typeof cfg.course_end_date !== 'string' || Number.isNaN(Date.parse(cfg.course_end_date))) {
    errors.push(`${course}.course_end_date is required and must be a parseable date string`);
  }
  if (!Number.isInteger(cfg.retention_days_after_end) || cfg.retention_days_after_end < 0) {
    errors.push(`${course}.retention_days_after_end is required and must be a non-negative integer`);
  }
  if (typeof cfg.allow_embed !== 'boolean') {
    errors.push(`${course}.allow_embed is required and must be a boolean`);
  }
  return errors;
}

function load(filePath) {
  const targetPath = filePath || process.env.CHECKIN_COURSES_FILE || DEFAULT_PATH;
  const raw = fs.readFileSync(targetPath, 'utf8');
  const data = JSON.parse(raw);

  const allErrors = [];
  Object.entries(data).forEach(([course, cfg]) => {
    allErrors.push(...validateCourseConfig(course, cfg));
  });
  if (allErrors.length > 0) {
    throw new Error(`Course config validation failed:\n${allErrors.join('\n')}`);
  }

  config = data;
  return config;
}

function ensureLoaded() {
  if (!config) load();
  return config;
}

function getCourseConfig(course) {
  ensureLoaded();
  return config[course] || null;
}

function getAllCourseConfigs() {
  ensureLoaded();
  return config;
}

module.exports = { load, ensureLoaded, getCourseConfig, getAllCourseConfigs };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && npx jest tests/checkin.courses.test.js`
Expected: `Tests: 6 passed, 6 total`

- [ ] **Step 6: Run the full suite to check for regressions**

Run: `cd server && npm test`
Expected: all existing suites still pass (107 tests before this task).

- [ ] **Step 7: Commit**

```bash
git add server/checkin/courses.json server/checkin/courses.js server/tests/checkin.courses.test.js
git commit -m "feat: add courses.json config and loader"
```

---

### Task 2: Wire identity_mode into routes.js, load courses.json at boot

**Files:**
- Modify: `server/checkin/routes.js`
- Modify: `server/index.js`
- Modify: `server/tests/checkin.routes.test.js`

- [ ] **Step 1: Update the failing/new tests**

`server/tests/checkin.routes.test.js` currently mocks `../checkin/db` but not `../checkin/courses`. `routes.js` is about to start calling `courses.getCourseConfig()`, so add a mock for it. Find the existing mock block near the top of the file:

```javascript
jest.mock('../checkin/db', () => ({
  isAvailable: () => mockAvailable,
  upsertParticipant: (...args) => mockUpsertParticipant(...args),
  findLatestResponseId: (...args) => mockFindLatestResponseId(...args),
  insertResponse: (...args) => mockInsertResponse(...args),
  recordInstrumentVersion: jest.fn().mockResolvedValue(true),
  initCheckinSchema: jest.fn().mockResolvedValue(true),
}));
```

Add a new mock right after it (same file, top-level):

```javascript
let mockCourseConfig = { identity_mode: 'email' };
jest.mock('../checkin/courses', () => ({
  getCourseConfig: (...args) => mockGetCourseConfig(...args),
  load: jest.fn(),
  ensureLoaded: jest.fn(),
  getAllCourseConfigs: jest.fn().mockReturnValue({}),
}));
const mockGetCourseConfig = jest.fn((course) => (course === 'OBLD500' ? mockCourseConfig : null));
```

(Declaring `mockGetCourseConfig` after the `jest.mock(...)` call works because Jest hoists `jest.mock()` calls to the top of the file, but the mock factory function itself only runs lazily on first `require('../checkin/courses')` -- by then `mockGetCourseConfig` will already be initialized. This mirrors the existing `mockUpsertParticipant`-style pattern already used in this same file.)

Then, in the `describe('POST /api/responses', ...)` block's `beforeEach`, reset the new mock alongside the existing ones:

```javascript
  beforeEach(() => {
    mockAvailable = true;
    app = createApp();
    mockUpsertParticipant.mockClear();
    mockFindLatestResponseId.mockClear().mockResolvedValue(null);
    mockInsertResponse.mockClear().mockResolvedValue({ id: 1, submitted_at: '2027-01-15T00:00:00Z' });
    mockCourseConfig = { identity_mode: 'email' };
    mockGetCourseConfig.mockClear();
  });
```

(This replaces the existing `beforeEach` in that `describe` block -- same content plus the two new lines resetting the course-config mock.)

Finally, add two new tests to the same `describe('POST /api/responses', ...)` block, near the other validation tests:

```javascript
  test('accepts a course with no courses.json entry, defaulting to email mode', async () => {
    mockGetCourseConfig.mockReturnValueOnce(null); // unknown course, no config entry
    const res = await request(app).post('/api/responses').send(validBaselineBody());
    expect(res.status).toBe(200);
  });

  test('returns 501 when the configured identity_mode is not "email"', async () => {
    mockCourseConfig = { identity_mode: 'key' };
    const res = await request(app).post('/api/responses').send(validBaselineBody());
    expect(res.status).toBe(501);
    expect(mockInsertResponse).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `cd server && npx jest tests/checkin.routes.test.js`
Expected: FAIL -- `routes.js` doesn't call `courses.getCourseConfig` yet, so the 501 test in particular will get a 200 instead.

- [ ] **Step 3: Update routes.js**

In `server/checkin/routes.js`, add the require near the top:

```javascript
const instrumentLoader = require('./instrumentLoader');
const identity = require('./identity');
const completionCode = require('./completionCode');
const scoring = require('./scoring');
const checkinDb = require('./db');
const courses = require('./courses');
```

Find this section inside `router.post('/responses', ...)`:

```javascript
    const instrument = instrumentLoader.getInstrument(course, moduleNum);
    if (!instrument) {
      return res.status(404).json({ error: 'Instrument not found' });
    }
```

Add the identity-mode check immediately before it:

```javascript
    const courseConfig = courses.getCourseConfig(course);
    const identityMode = courseConfig ? courseConfig.identity_mode : 'email';
    if (identityMode !== 'email') {
      return res.status(501).json({ error: `identity_mode "${identityMode}" is not yet implemented` });
    }

    const instrument = instrumentLoader.getInstrument(course, moduleNum);
    if (!instrument) {
      return res.status(404).json({ error: 'Instrument not found' });
    }
```

Then find the existing hardcoded `'email'` literal:

```javascript
    await checkinDb.upsertParticipant(participantId, emailEncrypted, 'email');
```

Replace it with the now-resolved `identityMode` variable:

```javascript
    await checkinDb.upsertParticipant(participantId, emailEncrypted, identityMode);
```

- [ ] **Step 4: Load courses.json at boot in index.js**

In `server/index.js`, add the require near the other checkin requires:

```javascript
const instrumentLoader = require('./checkin/instrumentLoader');
const checkinDb = require('./checkin/db');
const courses = require('./checkin/courses');
```

Find the existing instrument-loading try/catch in the boot block:

```javascript
  let loadedInstruments = null;
  try {
    loadedInstruments = instrumentLoader.load();
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
```

Add the equivalent block for courses.json right after it, same file, same principle (a bad `courses.json` should only degrade check-in identity/retention behavior, never take down chat or sessions):

```javascript
  try {
    courses.load();
    console.log('[CheckIn] Course config loaded and validated');
  } catch (err) {
    console.error('[CheckIn] Course config validation failed at boot -- check-in endpoints will error until this is fixed and redeployed:', err.message);
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && npx jest tests/checkin.routes.test.js`
Expected: `Tests: 20 passed, 20 total` (18 existing + 2 new -- recount against the actual file if this drifts; treat the file as authoritative).

- [ ] **Step 6: Run the full suite to check for regressions**

Run: `cd server && npm test`
Expected: all suites pass.

- [ ] **Step 7: Commit**

```bash
git add server/checkin/routes.js server/index.js server/tests/checkin.routes.test.js
git commit -m "feat: resolve identity_mode from courses.json, reject unimplemented modes"
```

---

### Task 3: Retention purge query functions

**Files:**
- Modify: `server/checkin/db.js`
- Modify: `server/tests/checkin.db.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/checkin.db.test.js`, after the existing `describe('recordInstrumentVersion', ...)` block, same file:

```javascript
describe('findParticipantIdsWithEmailByCourse', () => {
  test('returns distinct participant ids that still have an encrypted email on file', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ participant_id: 'p1' }, { participant_id: 'p2' }] });
    const ids = await checkinDb.findParticipantIdsWithEmailByCourse('OBLD500');
    expect(ids).toEqual(['p1', 'p2']);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('email_encrypted IS NOT NULL'), ['OBLD500']);
  });

  test('returns an empty array when nobody matches', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const ids = await checkinDb.findParticipantIdsWithEmailByCourse('OBLD500');
    expect(ids).toEqual([]);
  });
});

describe('purgeParticipantEmails', () => {
  test('nulls email_encrypted for the given participant ids', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 2 });
    const count = await checkinDb.purgeParticipantEmails(['p1', 'p2']);
    expect(count).toBe(2);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('SET email_encrypted = NULL'),
      [['p1', 'p2']]
    );
  });

  test('returns 0 and does not query when the id list is empty', async () => {
    const count = await checkinDb.purgeParticipantEmails([]);
    expect(count).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx jest tests/checkin.db.test.js`
Expected: FAIL -- `checkinDb.findParticipantIdsWithEmailByCourse is not a function`

- [ ] **Step 3: Add the implementation**

In `server/checkin/db.js`, add these two functions after `recordInstrumentVersion` and before the `module.exports` block:

```javascript
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
```

Update the `module.exports` block to include both:

```javascript
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx jest tests/checkin.db.test.js`
Expected: `Tests: 13 passed, 13 total` (9 existing + 4 new).

- [ ] **Step 5: Run the full suite**

Run: `cd server && npm test`

- [ ] **Step 6: Commit**

```bash
git add server/checkin/db.js server/tests/checkin.db.test.js
git commit -m "feat: add retention purge query functions"
```

---

### Task 4: Admin auth middleware

**Files:**
- Create: `server/checkin/adminAuth.js`
- Test: `server/tests/checkin.adminAuth.test.js`

- [ ] **Step 1: Write the failing tests**

Create `server/tests/checkin.adminAuth.test.js`:

```javascript
const express = require('express');
const request = require('supertest');

describe('requireAdminToken', () => {
  let app;
  const ORIGINAL_TOKEN = process.env.CHECKIN_ADMIN_TOKEN;

  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) delete process.env.CHECKIN_ADMIN_TOKEN;
    else process.env.CHECKIN_ADMIN_TOKEN = ORIGINAL_TOKEN;
  });

  function buildApp() {
    delete require.cache[require.resolve('../checkin/adminAuth')];
    const { requireAdminToken } = require('../checkin/adminAuth');
    const testApp = express();
    testApp.get('/protected', requireAdminToken, (req, res) => res.json({ ok: true }));
    return testApp;
  }

  test('returns 503 when CHECKIN_ADMIN_TOKEN is not configured', async () => {
    delete process.env.CHECKIN_ADMIN_TOKEN;
    app = buildApp();
    const res = await request(app).get('/protected');
    expect(res.status).toBe(503);
  });

  test('returns 401 when no token header is sent', async () => {
    process.env.CHECKIN_ADMIN_TOKEN = 'correct-token';
    app = buildApp();
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
  });

  test('returns 401 when the wrong token is sent', async () => {
    process.env.CHECKIN_ADMIN_TOKEN = 'correct-token';
    app = buildApp();
    const res = await request(app).get('/protected').set('X-Admin-Token', 'wrong-token');
    expect(res.status).toBe(401);
  });

  test('returns 401 when the token has the wrong length (does not throw)', async () => {
    process.env.CHECKIN_ADMIN_TOKEN = 'correct-token';
    app = buildApp();
    const res = await request(app).get('/protected').set('X-Admin-Token', 'short');
    expect(res.status).toBe(401);
  });

  test('allows the request through when the correct token is sent', async () => {
    process.env.CHECKIN_ADMIN_TOKEN = 'correct-token';
    app = buildApp();
    const res = await request(app).get('/protected').set('X-Admin-Token', 'correct-token');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx jest tests/checkin.adminAuth.test.js`
Expected: FAIL with `Cannot find module '../checkin/adminAuth'`

- [ ] **Step 3: Write the implementation**

Create `server/checkin/adminAuth.js`:

```javascript
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx jest tests/checkin.adminAuth.test.js`
Expected: `Tests: 5 passed, 5 total`

- [ ] **Step 5: Run the full suite**

Run: `cd server && npm test`

- [ ] **Step 6: Commit**

```bash
git add server/checkin/adminAuth.js server/tests/checkin.adminAuth.test.js
git commit -m "feat: add admin API token auth middleware"
```

---

### Task 5: Admin routes -- verify and summary

**Files:**
- Modify: `server/checkin/db.js`
- Create: `server/checkin/adminRoutes.js`
- Test: `server/tests/checkin.adminRoutes.test.js`

This task creates `adminRoutes.js`; Tasks 6 and 7 add more routes to the same file and test file.

- [ ] **Step 1: Add the two new db.js query functions**

In `server/checkin/db.js`, add after `purgeParticipantEmails` (from Task 3) and before `module.exports`:

```javascript
async function findResponseByCompletionCode(code) {
  const p = getPool();
  const result = await p.query(
    `SELECT course, module, phase, submitted_at FROM checkin_responses WHERE completion_code = $1`,
    [code]
  );
  return result.rows.length ? result.rows[0] : null;
}

async function getSummary(course) {
  const p = getPool();
  const result = await p.query(
    `SELECT module, phase, count(*)::int AS total,
            count(*) FILTER (WHERE straightline_flag)::int AS straightline_count,
            max(submitted_at) AS last_submission
     FROM checkin_responses
     WHERE course = $1
     GROUP BY module, phase
     ORDER BY module, phase`,
    [course]
  );
  return result.rows;
}
```

Update `module.exports` to add both:

```javascript
module.exports = {
  isAvailable,
  initCheckinSchema,
  upsertParticipant,
  findLatestResponseId,
  insertResponse,
  recordInstrumentVersion,
  findParticipantIdsWithEmailByCourse,
  purgeParticipantEmails,
  findResponseByCompletionCode,
  getSummary,
};
```

- [ ] **Step 2: Write the failing db.js tests**

Append to `server/tests/checkin.db.test.js`:

```javascript
describe('findResponseByCompletionCode', () => {
  test('returns the matching response row', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ course: 'OBLD500', module: 4, phase: 'baseline', submitted_at: '2027-01-15T00:00:00Z' }],
    });
    const match = await checkinDb.findResponseByCompletionCode('AL4-B-K7Q2M9PX');
    expect(match).toEqual({ course: 'OBLD500', module: 4, phase: 'baseline', submitted_at: '2027-01-15T00:00:00Z' });
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE completion_code = $1'), ['AL4-B-K7Q2M9PX']);
  });

  test('returns null when no response matches', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const match = await checkinDb.findResponseByCompletionCode('NOT-A-REAL-CODE');
    expect(match).toBeNull();
  });
});

describe('getSummary', () => {
  test('returns per module/phase counts', async () => {
    const rows = [
      { module: 4, phase: 'baseline', total: 10, straightline_count: 1, last_submission: '2027-01-20T00:00:00Z' },
      { module: 4, phase: 'debrief', total: 8, straightline_count: 0, last_submission: '2027-03-01T00:00:00Z' },
    ];
    mockQuery.mockResolvedValueOnce({ rows });
    const summary = await checkinDb.getSummary('OBLD500');
    expect(summary).toEqual(rows);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('GROUP BY module, phase'), ['OBLD500']);
  });
});
```

- [ ] **Step 3: Run the db.js tests to verify they fail, then pass**

Run: `cd server && npx jest tests/checkin.db.test.js`
Expected first FAIL (`findResponseByCompletionCode is not a function`), then after Step 1's implementation is in place, `Tests: 17 passed, 17 total` (13 from Task 3 + 4 new).

- [ ] **Step 4: Write the failing adminRoutes tests**

Create `server/tests/checkin.adminRoutes.test.js`:

```javascript
const request = require('supertest');

const mockFindResponseByCompletionCode = jest.fn();
const mockGetSummary = jest.fn();

jest.mock('../checkin/db', () => ({
  isAvailable: () => true,
  findResponseByCompletionCode: (...args) => mockFindResponseByCompletionCode(...args),
  getSummary: (...args) => mockGetSummary(...args),
}));

function buildApp() {
  delete require.cache[require.resolve('../checkin/adminRoutes')];
  delete require.cache[require.resolve('../checkin/adminAuth')];
  const express = require('express');
  const adminRoutes = require('../checkin/adminRoutes');
  const app = express();
  app.use('/api/admin', adminRoutes);
  return app;
}

const ADMIN_TOKEN = 'test-admin-token';

describe('admin routes', () => {
  let app;
  const ORIGINAL_TOKEN = process.env.CHECKIN_ADMIN_TOKEN;

  beforeEach(() => {
    process.env.CHECKIN_ADMIN_TOKEN = ADMIN_TOKEN;
    app = buildApp();
    mockFindResponseByCompletionCode.mockReset();
    mockGetSummary.mockReset();
  });

  afterAll(() => {
    if (ORIGINAL_TOKEN === undefined) delete process.env.CHECKIN_ADMIN_TOKEN;
    else process.env.CHECKIN_ADMIN_TOKEN = ORIGINAL_TOKEN;
  });

  describe('GET /api/admin/verify', () => {
    test('returns valid: true with response details for a known code', async () => {
      mockFindResponseByCompletionCode.mockResolvedValueOnce({
        course: 'OBLD500', module: 4, phase: 'baseline', submitted_at: '2027-01-15T00:00:00Z',
      });
      const res = await request(app)
        .get('/api/admin/verify?code=AL4-B-K7Q2M9PX')
        .set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        valid: true, course: 'OBLD500', module: 4, phase: 'baseline', submitted_at: '2027-01-15T00:00:00Z',
      });
    });

    test('returns valid: false for an unknown code', async () => {
      mockFindResponseByCompletionCode.mockResolvedValueOnce(null);
      const res = await request(app)
        .get('/api/admin/verify?code=NOT-REAL')
        .set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ valid: false });
    });

    test('returns 400 when code is missing', async () => {
      const res = await request(app).get('/api/admin/verify').set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(400);
    });

    test('returns 401 without a valid admin token', async () => {
      const res = await request(app).get('/api/admin/verify?code=AL4-B-K7Q2M9PX');
      expect(res.status).toBe(401);
      expect(mockFindResponseByCompletionCode).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/admin/summary', () => {
    test('returns the course summary', async () => {
      const rows = [{ module: 4, phase: 'baseline', total: 10, straightline_count: 1, last_submission: '2027-01-20T00:00:00Z' }];
      mockGetSummary.mockResolvedValueOnce(rows);
      const res = await request(app)
        .get('/api/admin/summary?course=OBLD500')
        .set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ course: 'OBLD500', summary: rows });
    });

    test('returns 400 when course is missing', async () => {
      const res = await request(app).get('/api/admin/summary').set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(400);
    });
  });
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `cd server && npx jest tests/checkin.adminRoutes.test.js`
Expected: FAIL with `Cannot find module '../checkin/adminRoutes'`

- [ ] **Step 6: Write the implementation**

Create `server/checkin/adminRoutes.js`:

```javascript
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd server && npx jest tests/checkin.adminRoutes.test.js`
Expected: `Tests: 6 passed, 6 total`

- [ ] **Step 8: Run the full suite**

Run: `cd server && npm test`

- [ ] **Step 9: Commit**

```bash
git add server/checkin/db.js server/checkin/adminRoutes.js server/tests/checkin.db.test.js server/tests/checkin.adminRoutes.test.js
git commit -m "feat: add admin verify and summary endpoints"
```

---

### Task 6: Admin routes -- export (long and paired, json and csv)

**Files:**
- Modify: `server/checkin/db.js`
- Create: `server/checkin/csv.js`
- Modify: `server/checkin/adminRoutes.js`
- Test: `server/tests/checkin.csv.test.js`
- Modify: `server/tests/checkin.db.test.js`
- Modify: `server/tests/checkin.adminRoutes.test.js`

- [ ] **Step 1: Write the failing csv.js tests**

Create `server/tests/checkin.csv.test.js`:

```javascript
const { toCsv } = require('../checkin/csv');

describe('toCsv', () => {
  test('returns an empty string for no rows', () => {
    expect(toCsv([])).toBe('');
  });

  test('writes a header row from the first row\'s keys', () => {
    const csv = toCsv([{ a: 1, b: 2 }]);
    expect(csv.split('\n')[0]).toBe('a,b');
  });

  test('writes one line per row in the same column order as the header', () => {
    const csv = toCsv([{ a: 1, b: 2 }, { a: 3, b: 4 }]);
    const lines = csv.split('\n');
    expect(lines).toEqual(['a,b', '1,2', '3,4']);
  });

  test('quotes and escapes a field containing a comma', () => {
    const csv = toCsv([{ text: 'hello, world' }]);
    expect(csv.split('\n')[1]).toBe('"hello, world"');
  });

  test('quotes and escapes a field containing a double quote', () => {
    const csv = toCsv([{ text: 'she said "hi"' }]);
    expect(csv.split('\n')[1]).toBe('"she said ""hi"""');
  });

  test('quotes a field containing a newline', () => {
    const csv = toCsv([{ text: 'line one\nline two' }]);
    expect(csv.split('\n')).toHaveLength(3); // header + 1 data row that itself spans 2 lines
    expect(csv).toContain('"line one\nline two"');
  });

  test('renders null and undefined as empty fields', () => {
    const csv = toCsv([{ a: null, b: undefined }]);
    expect(csv.split('\n')[1]).toBe(',');
  });

  test('serializes a Date value as an ISO string', () => {
    const csv = toCsv([{ when: new Date('2027-01-15T00:00:00.000Z') }]);
    expect(csv.split('\n')[1]).toBe('2027-01-15T00:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx jest tests/checkin.csv.test.js`
Expected: FAIL with `Cannot find module '../checkin/csv'`

- [ ] **Step 3: Write csv.js**

Create `server/checkin/csv.js`:

```javascript
function escapeField(value) {
  if (value == null) return '';
  const str = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(rows) {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeField(row[h])).join(','));
  }
  return lines.join('\n');
}

module.exports = { toCsv };
```

- [ ] **Step 4: Run the csv.js tests to verify they pass**

Run: `cd server && npx jest tests/checkin.csv.test.js`
Expected: `Tests: 8 passed, 8 total`

- [ ] **Step 5: Add the export query functions and pivot helper to db.js**

In `server/checkin/db.js`, add after `getSummary` and before `module.exports`:

```javascript
async function getExportLongRows(course) {
  const p = getPool();
  const result = await p.query(
    `SELECT cr.id AS response_id, cr.course, cr.module, cr.phase, cr.participant_id,
            cr.instrument_version, cr.started_at, cr.submitted_at, cr.straightline_flag,
            cr.completion_code, cri.item_id, cri.raw_value, cri.scored_value
     FROM checkin_responses cr
     JOIN checkin_response_items cri ON cri.response_id = cr.id
     WHERE cr.course = $1
     ORDER BY cr.id, cri.item_id`,
    [course]
  );
  return result.rows;
}

async function getExportPairedRows(course) {
  const p = getPool();
  const result = await p.query(
    `SELECT cr.participant_id, cr.module, cr.phase, css.subscale_id, css.mean
     FROM checkin_responses cr
     JOIN checkin_subscale_scores css ON css.response_id = cr.id
     WHERE cr.course = $1
       AND cr.id = (
         SELECT id FROM checkin_responses cr2
         WHERE cr2.participant_id = cr.participant_id AND cr2.course = cr.course
           AND cr2.module = cr.module AND cr2.phase = cr.phase
         ORDER BY submitted_at DESC, id DESC LIMIT 1
       )
     ORDER BY cr.participant_id, cr.module, css.subscale_id, cr.phase`,
    [course]
  );
  return result.rows;
}
```

Update `module.exports` to add both:

```javascript
module.exports = {
  isAvailable,
  initCheckinSchema,
  upsertParticipant,
  findLatestResponseId,
  insertResponse,
  recordInstrumentVersion,
  findParticipantIdsWithEmailByCourse,
  purgeParticipantEmails,
  findResponseByCompletionCode,
  getSummary,
  getExportLongRows,
  getExportPairedRows,
};
```

- [ ] **Step 6: Write the failing db.js export tests**

Append to `server/tests/checkin.db.test.js`:

```javascript
describe('getExportLongRows', () => {
  test('returns one row per response item, joined with response metadata', async () => {
    const rows = [
      { response_id: 1, course: 'OBLD500', module: 4, phase: 'baseline', participant_id: 'p1', item_id: 'AL01', raw_value: 5, scored_value: 5 },
    ];
    mockQuery.mockResolvedValueOnce({ rows });
    const result = await checkinDb.getExportLongRows('OBLD500');
    expect(result).toEqual(rows);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('JOIN checkin_response_items'), ['OBLD500']);
  });
});

describe('getExportPairedRows', () => {
  test('returns raw participant/module/subscale/phase/mean rows for pivoting', async () => {
    const rows = [
      { participant_id: 'p1', module: 4, phase: 'baseline', subscale_id: 'sensing', mean: '5.00' },
      { participant_id: 'p1', module: 4, phase: 'debrief', subscale_id: 'sensing', mean: '6.00' },
    ];
    mockQuery.mockResolvedValueOnce({ rows });
    const result = await checkinDb.getExportPairedRows('OBLD500');
    expect(result).toEqual(rows);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('JOIN checkin_subscale_scores'), ['OBLD500']);
  });
});
```

- [ ] **Step 7: Run the db.js tests to verify they pass**

Run: `cd server && npx jest tests/checkin.db.test.js`
Expected: `Tests: 19 passed, 19 total` (17 from Task 5 + 2 new).

- [ ] **Step 8: Add the export route and pivot helper to adminRoutes.js**

In `server/checkin/adminRoutes.js`, add the require near the top:

```javascript
const { requireAdminToken } = require('./adminAuth');
const checkinDb = require('./db');
const { toCsv } = require('./csv');
```

Add this helper function above `module.exports = router;`:

```javascript
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
```

Add the route, above `module.exports = router;`:

```javascript
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
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 9: Extend the adminRoutes tests**

In `server/tests/checkin.adminRoutes.test.js`, add to the top-level mock block (find the existing `jest.mock('../checkin/db', ...)` call and replace it with this expanded version):

```javascript
const mockFindResponseByCompletionCode = jest.fn();
const mockGetSummary = jest.fn();
const mockGetExportLongRows = jest.fn();
const mockGetExportPairedRows = jest.fn();

jest.mock('../checkin/db', () => ({
  isAvailable: () => true,
  findResponseByCompletionCode: (...args) => mockFindResponseByCompletionCode(...args),
  getSummary: (...args) => mockGetSummary(...args),
  getExportLongRows: (...args) => mockGetExportLongRows(...args),
  getExportPairedRows: (...args) => mockGetExportPairedRows(...args),
}));
```

In the outer `describe('admin routes', ...)` block's `beforeEach`, add resets for the two new mocks (alongside the existing `mockFindResponseByCompletionCode.mockReset(); mockGetSummary.mockReset();`):

```javascript
    mockGetExportLongRows.mockReset();
    mockGetExportPairedRows.mockReset();
```

Add a new nested `describe` block, alongside the existing `describe('GET /api/admin/verify', ...)` and `describe('GET /api/admin/summary', ...)` blocks:

```javascript
  describe('GET /api/admin/export', () => {
    test('long shape, json format returns raw rows', async () => {
      const rows = [{ response_id: 1, item_id: 'AL01', raw_value: 5 }];
      mockGetExportLongRows.mockResolvedValueOnce(rows);
      const res = await request(app)
        .get('/api/admin/export?course=OBLD500&shape=long&format=json')
        .set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ course: 'OBLD500', shape: 'long', rows });
    });

    test('long shape, csv format returns a CSV body', async () => {
      mockGetExportLongRows.mockResolvedValueOnce([{ a: 1, b: 2 }]);
      const res = await request(app)
        .get('/api/admin/export?course=OBLD500&shape=long&format=csv')
        .set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.text).toBe('a,b\n1,2');
    });

    test('paired shape pivots baseline/debrief rows into one row per subscale', async () => {
      mockGetExportPairedRows.mockResolvedValueOnce([
        { participant_id: 'p1', module: 4, phase: 'baseline', subscale_id: 'sensing', mean: '5.00' },
        { participant_id: 'p1', module: 4, phase: 'debrief', subscale_id: 'sensing', mean: '6.00' },
      ]);
      const res = await request(app)
        .get('/api/admin/export?course=OBLD500&shape=paired&format=json')
        .set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body.rows).toEqual([
        { participant_id: 'p1', module: 4, subscale_id: 'sensing', baseline_mean: 5, debrief_mean: 6, delta: 1 },
      ]);
    });

    test('defaults to format=json, shape=long when not specified', async () => {
      mockGetExportLongRows.mockResolvedValueOnce([]);
      const res = await request(app)
        .get('/api/admin/export?course=OBLD500')
        .set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body.shape).toBe('long');
      expect(mockGetExportLongRows).toHaveBeenCalledWith('OBLD500');
    });

    test('returns 400 for an invalid format', async () => {
      const res = await request(app)
        .get('/api/admin/export?course=OBLD500&format=xml')
        .set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(400);
    });

    test('returns 400 for an invalid shape', async () => {
      const res = await request(app)
        .get('/api/admin/export?course=OBLD500&shape=triangular')
        .set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(400);
    });
  });
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `cd server && npx jest tests/checkin.adminRoutes.test.js`
Expected: `Tests: 12 passed, 12 total` (6 from Task 5 + 6 new).

- [ ] **Step 11: Run the full suite**

Run: `cd server && npm test`

- [ ] **Step 12: Commit**

```bash
git add server/checkin/db.js server/checkin/csv.js server/checkin/adminRoutes.js server/tests/checkin.csv.test.js server/tests/checkin.db.test.js server/tests/checkin.adminRoutes.test.js
git commit -m "feat: add admin export endpoint (long/paired, json/csv)"
```

---

### Task 7: Admin routes -- instrument reload, participant deletion, retention purge

**Files:**
- Modify: `server/checkin/db.js`
- Modify: `server/checkin/adminRoutes.js`
- Modify: `server/tests/checkin.adminRoutes.test.js`

- [ ] **Step 1: Add deleteParticipant to db.js**

In `server/checkin/db.js`, add after `getExportPairedRows` and before `module.exports`:

```javascript
async function deleteParticipant(participantId) {
  const p = getPool();
  // Delete responses first: checkin_responses.participant_id has no ON DELETE
  // CASCADE from checkin_participants (only the reverse -- response_items and
  // subscale_scores cascade FROM checkin_responses). Deleting the participant
  // row first would hit a foreign key violation if any responses still exist.
  const responsesResult = await p.query(`DELETE FROM checkin_responses WHERE participant_id = $1`, [participantId]);
  const participantResult = await p.query(`DELETE FROM checkin_participants WHERE participant_id = $1`, [participantId]);
  return { responses_deleted: responsesResult.rowCount, participant_deleted: participantResult.rowCount > 0 };
}
```

Update `module.exports`:

```javascript
module.exports = {
  isAvailable,
  initCheckinSchema,
  upsertParticipant,
  findLatestResponseId,
  insertResponse,
  recordInstrumentVersion,
  findParticipantIdsWithEmailByCourse,
  purgeParticipantEmails,
  findResponseByCompletionCode,
  getSummary,
  getExportLongRows,
  getExportPairedRows,
  deleteParticipant,
};
```

- [ ] **Step 2: Write the failing db.js test**

Append to `server/tests/checkin.db.test.js`:

```javascript
describe('deleteParticipant', () => {
  test('deletes responses before the participant row, in that order', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 3 }) // responses deleted
      .mockResolvedValueOnce({ rowCount: 1 }); // participant deleted
    const result = await checkinDb.deleteParticipant('p1');
    expect(result).toEqual({ responses_deleted: 3, participant_deleted: true });
    expect(mockQuery.mock.calls[0][0]).toContain('DELETE FROM checkin_responses');
    expect(mockQuery.mock.calls[1][0]).toContain('DELETE FROM checkin_participants');
  });

  test('participant_deleted is false when no participant row existed', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({ rowCount: 0 });
    const result = await checkinDb.deleteParticipant('nonexistent');
    expect(result.participant_deleted).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify fail, then pass**

Run: `cd server && npx jest tests/checkin.db.test.js`
Expected after Step 1's implementation: `Tests: 21 passed, 21 total` (19 from Task 6 + 2 new).

- [ ] **Step 4: Add the three remaining admin routes**

In `server/checkin/adminRoutes.js`, add these requires near the top, alongside the existing ones:

```javascript
const instrumentLoader = require('./instrumentLoader');
const courses = require('./courses');
```

Add these three routes above `module.exports = router;`:

```javascript
router.post('/instruments/reload', (req, res) => {
  try {
    instrumentLoader.reload();
    res.json({ ok: true });
  } catch (err) {
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
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
      const ids = await checkinDb.findParticipantIdsWithEmailByCourse(course);
      const purged = await checkinDb.purgeParticipantEmails(ids);
      results.push({ course, purged, threshold: threshold.toISOString(), status: 'purged' });
    }
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

This endpoint is safe to call repeatedly (idempotent -- `purgeParticipantEmails` only touches rows that still have `email_encrypted IS NOT NULL`, so a second call after a successful purge finds nothing left to do). It is not scheduled anywhere by this plan; running it periodically (e.g. a daily trigger) is an infrastructure follow-up, not a code task.

- [ ] **Step 5: Write the failing adminRoutes tests**

In `server/tests/checkin.adminRoutes.test.js`, expand the mock block once more (replace the whole `jest.mock('../checkin/db', ...)` block from Task 6 with this version, adding `deleteParticipant` and `findParticipantIdsWithEmailByCourse`/`purgeParticipantEmails`):

```javascript
const mockFindResponseByCompletionCode = jest.fn();
const mockGetSummary = jest.fn();
const mockGetExportLongRows = jest.fn();
const mockGetExportPairedRows = jest.fn();
const mockDeleteParticipant = jest.fn();
const mockFindParticipantIdsWithEmailByCourse = jest.fn();
const mockPurgeParticipantEmails = jest.fn();

jest.mock('../checkin/db', () => ({
  isAvailable: () => true,
  findResponseByCompletionCode: (...args) => mockFindResponseByCompletionCode(...args),
  getSummary: (...args) => mockGetSummary(...args),
  getExportLongRows: (...args) => mockGetExportLongRows(...args),
  getExportPairedRows: (...args) => mockGetExportPairedRows(...args),
  deleteParticipant: (...args) => mockDeleteParticipant(...args),
  findParticipantIdsWithEmailByCourse: (...args) => mockFindParticipantIdsWithEmailByCourse(...args),
  purgeParticipantEmails: (...args) => mockPurgeParticipantEmails(...args),
}));

const mockGetAllCourseConfigs = jest.fn();
jest.mock('../checkin/courses', () => ({
  getAllCourseConfigs: () => mockGetAllCourseConfigs(),
  load: jest.fn(),
  ensureLoaded: jest.fn(),
  getCourseConfig: jest.fn(),
}));

const mockInstrumentReload = jest.fn();
jest.mock('../checkin/instrumentLoader', () => ({
  reload: (...args) => mockInstrumentReload(...args),
  load: jest.fn(),
  ensureLoaded: jest.fn(),
  getInstrument: jest.fn(),
  getPublicView: jest.fn(),
}));
```

Add resets in the outer `beforeEach` for all the new mocks:

```javascript
    mockDeleteParticipant.mockReset();
    mockFindParticipantIdsWithEmailByCourse.mockReset();
    mockPurgeParticipantEmails.mockReset();
    mockGetAllCourseConfigs.mockReset().mockReturnValue({});
    mockInstrumentReload.mockReset();
```

Add three new nested `describe` blocks:

```javascript
  describe('POST /api/admin/instruments/reload', () => {
    test('reloads and returns ok', async () => {
      mockInstrumentReload.mockReturnValueOnce(new Map());
      const res = await request(app).post('/api/admin/instruments/reload').set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(mockInstrumentReload).toHaveBeenCalled();
    });

    test('returns 400 when reload throws (bad instrument file)', async () => {
      mockInstrumentReload.mockImplementationOnce(() => { throw new Error('bad instrument'); });
      const res = await request(app).post('/api/admin/instruments/reload').set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/admin/participant', () => {
    test('deletes a participant and their responses', async () => {
      mockDeleteParticipant.mockResolvedValueOnce({ responses_deleted: 2, participant_deleted: true });
      const res = await request(app)
        .delete('/api/admin/participant?participant_id=p1')
        .set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ responses_deleted: 2, participant_deleted: true });
    });

    test('returns 400 when participant_id is missing', async () => {
      const res = await request(app).delete('/api/admin/participant').set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/admin/purge-expired', () => {
    test('purges a course whose threshold has passed', async () => {
      mockGetAllCourseConfigs.mockReturnValueOnce({
        OBLD500: { course_end_date: '2020-01-01', retention_days_after_end: 1 }, // long past
      });
      mockFindParticipantIdsWithEmailByCourse.mockResolvedValueOnce(['p1', 'p2']);
      mockPurgeParticipantEmails.mockResolvedValueOnce(2);
      const res = await request(app).post('/api/admin/purge-expired').set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body.results).toEqual([{ course: 'OBLD500', purged: 2, threshold: expect.any(String), status: 'purged' }]);
    });

    test('does not purge a course whose threshold has not passed yet', async () => {
      mockGetAllCourseConfigs.mockReturnValueOnce({
        OBLD500: { course_end_date: '2099-01-01', retention_days_after_end: 90 }, // far future
      });
      const res = await request(app).post('/api/admin/purge-expired').set('X-Admin-Token', ADMIN_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body.results).toEqual([{ course: 'OBLD500', purged: 0, threshold: expect.any(String), status: 'not yet due' }]);
      expect(mockFindParticipantIdsWithEmailByCourse).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd server && npx jest tests/checkin.adminRoutes.test.js`
Expected: `Tests: 18 passed, 18 total` (12 from Task 6 + 6 new).

- [ ] **Step 7: Run the full suite**

Run: `cd server && npm test`

- [ ] **Step 8: Commit**

```bash
git add server/checkin/db.js server/checkin/adminRoutes.js server/tests/checkin.db.test.js server/tests/checkin.adminRoutes.test.js
git commit -m "feat: add instrument reload, participant deletion, and retention purge admin endpoints"
```

---

### Task 8: Mount the admin router

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Add the require and mount point**

In `server/index.js`, add the require near the other checkin requires:

```javascript
const checkinRoutes = require('./checkin/routes');
const adminRoutes = require('./checkin/adminRoutes');
const instrumentLoader = require('./checkin/instrumentLoader');
const checkinDb = require('./checkin/db');
const courses = require('./checkin/courses');
```

Find:

```javascript
app.use('/api', checkinRoutes);
```

Add the admin mount immediately before it (more specific path first, per this plan's own deviation note above):

```javascript
app.use('/api/admin', adminRoutes);
app.use('/api', checkinRoutes);
```

- [ ] **Step 2: Run the full suite**

Run: `cd server && npm test`
Expected: all suites pass, including a sanity check that mounting `adminRoutes` doesn't disturb any existing route's behavior.

- [ ] **Step 3: Manual verification**

Run: `cd client && npm run build` (confirm the client still builds -- this task doesn't touch the client, but it's a cheap, standard check before moving on).

Start the server locally with all four check-in secrets set (`CHECKIN_HMAC_SECRET`, `CHECKIN_AES_KEY`, and now also `CHECKIN_ADMIN_TOKEN`):

```bash
cd server
CHECKIN_HMAC_SECRET=test-secret \
CHECKIN_AES_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))") \
CHECKIN_ADMIN_TOKEN=test-admin-token \
node index.js &
```

```bash
curl -s -w "\nHTTP %{http_code}\n" http://localhost:3000/api/admin/summary?course=OBLD500 -H "X-Admin-Token: wrong-token"
curl -s -w "\nHTTP %{http_code}\n" http://localhost:3000/api/admin/summary?course=OBLD500 -H "X-Admin-Token: test-admin-token"
```

Expected: first request 401 (wrong token); second request 200 with `{"course":"OBLD500","summary":[]}` (200 because `getSummary` runs against a real, empty-of-check-in-data local Postgres if `DATABASE_URL` happens to be set, or a 503 "Database not configured" if it isn't -- both are correct, expected outcomes depending on your local setup; the point of this check is confirming the admin token gating actually works end to end, not exercising the DB query itself, which is already covered by the unit tests above).

Stop the background server afterward.

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "feat: mount the admin API router at /api/admin"
```

---

### Task 9: "Then and now" -- server side

**Files:**
- Modify: `server/checkin/db.js`
- Modify: `server/checkin/routes.js`
- Modify: `server/tests/checkin.db.test.js`
- Modify: `server/tests/checkin.routes.test.js`

- [ ] **Step 1: Add findLatestSubscaleScores to db.js**

In `server/checkin/db.js`, add after `deleteParticipant` and before `module.exports`:

```javascript
async function findLatestSubscaleScores(participantId, course, moduleNum, phase) {
  const p = getPool();
  const result = await p.query(
    `SELECT css.subscale_id, css.mean, css.n_items
     FROM checkin_subscale_scores css
     WHERE css.response_id = (
       SELECT id FROM checkin_responses
       WHERE participant_id = $1 AND course = $2 AND module = $3 AND phase = $4
       ORDER BY submitted_at DESC, id DESC LIMIT 1
     )`,
    [participantId, course, moduleNum, phase]
  );
  return result.rows.length
    ? result.rows.map((r) => ({ subscale_id: r.subscale_id, mean: Number(r.mean), n_items: r.n_items }))
    : null;
}
```

Update `module.exports`:

```javascript
module.exports = {
  isAvailable,
  initCheckinSchema,
  upsertParticipant,
  findLatestResponseId,
  insertResponse,
  recordInstrumentVersion,
  findParticipantIdsWithEmailByCourse,
  purgeParticipantEmails,
  findResponseByCompletionCode,
  getSummary,
  getExportLongRows,
  getExportPairedRows,
  deleteParticipant,
  findLatestSubscaleScores,
};
```

- [ ] **Step 2: Write the failing db.js test**

Append to `server/tests/checkin.db.test.js`:

```javascript
describe('findLatestSubscaleScores', () => {
  test('returns the subscale scores for the most recent matching response', async () => {
    const rows = [{ subscale_id: 'sensing', mean: '5.80', n_items: 5 }];
    mockQuery.mockResolvedValueOnce({ rows });
    const scores = await checkinDb.findLatestSubscaleScores('p1', 'OBLD500', 4, 'baseline');
    expect(scores).toEqual([{ subscale_id: 'sensing', mean: 5.8, n_items: 5 }]);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('ORDER BY submitted_at DESC, id DESC LIMIT 1'), ['p1', 'OBLD500', 4, 'baseline']);
  });

  test('returns null when there is no matching response', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const scores = await checkinDb.findLatestSubscaleScores('p1', 'OBLD500', 4, 'baseline');
    expect(scores).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify fail, then pass**

Run: `cd server && npx jest tests/checkin.db.test.js`
Expected after Step 1: `Tests: 23 passed, 23 total` (21 from Task 7 + 2 new).

- [ ] **Step 4: Compute and include baseline_comparison in routes.js**

In `server/tests/checkin.routes.test.js`, first extend the `../checkin/db` mock to include the new function. Find the existing mock (already modified once by Task 2):

```javascript
jest.mock('../checkin/db', () => ({
  isAvailable: () => mockAvailable,
  upsertParticipant: (...args) => mockUpsertParticipant(...args),
  findLatestResponseId: (...args) => mockFindLatestResponseId(...args),
  insertResponse: (...args) => mockInsertResponse(...args),
  recordInstrumentVersion: jest.fn().mockResolvedValue(true),
  initCheckinSchema: jest.fn().mockResolvedValue(true),
}));
```

Replace it with:

```javascript
const mockFindLatestSubscaleScores = jest.fn().mockResolvedValue(null);

jest.mock('../checkin/db', () => ({
  isAvailable: () => mockAvailable,
  upsertParticipant: (...args) => mockUpsertParticipant(...args),
  findLatestResponseId: (...args) => mockFindLatestResponseId(...args),
  insertResponse: (...args) => mockInsertResponse(...args),
  findLatestSubscaleScores: (...args) => mockFindLatestSubscaleScores(...args),
  recordInstrumentVersion: jest.fn().mockResolvedValue(true),
  initCheckinSchema: jest.fn().mockResolvedValue(true),
}));
```

In the `describe('POST /api/responses', ...)` block's `beforeEach` (already modified once by Task 2), add a reset for the new mock:

```javascript
    mockFindLatestSubscaleScores.mockClear().mockResolvedValue(null);
```

Add two new tests to the same `describe` block, near the existing debrief-related tests:

```javascript
  test('includes baseline_comparison in a debrief response when a baseline exists', async () => {
    mockFindLatestSubscaleScores.mockResolvedValueOnce([
      { subscale_id: 'sensing', mean: 5, n_items: 5 },
      { subscale_id: 'attending', mean: 4, n_items: 5 },
      { subscale_id: 'processing', mean: 5, n_items: 5 },
      { subscale_id: 'responding', mean: 5, n_items: 5 },
    ]);
    const body = {
      ...validBaselineBody(),
      phase: 'debrief',
      extras: {
        post_experience: { AL_PX1: 6, AL_PX2: 6, AL_PX3: 6, AL_PX4: 6, AL_PX5: 6 },
        open_ended: { AL_Q1: 'A'.repeat(40), AL_Q2: 'B'.repeat(40), AL_Q3: 'C'.repeat(40) },
      },
    };
    const res = await request(app).post('/api/responses').send(body);
    expect(res.status).toBe(200);
    expect(res.body.baseline_comparison).toBeDefined();
    expect(res.body.baseline_comparison).toHaveLength(4);
    const sensing = res.body.baseline_comparison.find((c) => c.subscale_id === 'sensing');
    expect(sensing.baseline_mean).toBe(5);
    expect(sensing.debrief_mean).toBe(5); // body's AL01-05 all answered 5
    expect(sensing.delta).toBe(0);
  });

  test('omits baseline_comparison when no baseline exists yet', async () => {
    mockFindLatestSubscaleScores.mockResolvedValueOnce(null);
    const body = {
      ...validBaselineBody(),
      phase: 'debrief',
      extras: {
        post_experience: { AL_PX1: 6, AL_PX2: 6, AL_PX3: 6, AL_PX4: 6, AL_PX5: 6 },
        open_ended: { AL_Q1: 'A'.repeat(40), AL_Q2: 'B'.repeat(40), AL_Q3: 'C'.repeat(40) },
      },
    };
    const res = await request(app).post('/api/responses').send(body);
    expect(res.status).toBe(200);
    expect(res.body.baseline_comparison).toBeUndefined();
  });

  test('does not look up a baseline comparison for a baseline submission itself', async () => {
    await request(app).post('/api/responses').send(validBaselineBody());
    expect(mockFindLatestSubscaleScores).not.toHaveBeenCalled();
  });
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `cd server && npx jest tests/checkin.routes.test.js`
Expected: FAIL -- `routes.js` doesn't call `findLatestSubscaleScores` or include `baseline_comparison` yet.

- [ ] **Step 6: Update routes.js**

Find this line inside `router.post('/responses', ...)`:

```javascript
    res.json({ completion_code: code, subscale_means: subscaleScores });
```

Replace it with:

```javascript
    let baselineComparison;
    if (phase === 'debrief') {
      const baselineScores = await checkinDb.findLatestSubscaleScores(participantId, course, moduleNum, 'baseline');
      if (baselineScores) {
        baselineComparison = subscaleScores.map((debriefScore) => {
          const baselineScore = baselineScores.find((b) => b.subscale_id === debriefScore.subscale_id);
          return {
            subscale_id: debriefScore.subscale_id,
            baseline_mean: baselineScore ? baselineScore.mean : null,
            debrief_mean: debriefScore.mean,
            delta: baselineScore ? Math.round((debriefScore.mean - baselineScore.mean) * 100) / 100 : null,
          };
        });
      }
    }

    res.json({
      completion_code: code,
      subscale_means: subscaleScores,
      ...(baselineComparison ? { baseline_comparison: baselineComparison } : {}),
    });
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd server && npx jest tests/checkin.routes.test.js`
Expected: `Tests: 23 passed, 23 total` (20 from Task 2 + 3 new).

- [ ] **Step 8: Run the full suite**

Run: `cd server && npm test`

- [ ] **Step 9: Commit**

```bash
git add server/checkin/db.js server/checkin/routes.js server/tests/checkin.db.test.js server/tests/checkin.routes.test.js
git commit -m "feat: include baseline_comparison in debrief POST /api/responses"
```

---

### Task 10: "Then and now" -- client side

**Files:**
- Modify: `client/src/CheckIn.jsx`

- [ ] **Step 1: Add the ThenAndNowPanel component**

In `client/src/CheckIn.jsx`, add above `export default function CheckIn`, near `ConfirmationScreen`:

```jsx
function ThenAndNowPanel({ comparisons, subscales }) {
  return (
    <div style={{ marginTop: 24, textAlign: "left" }}>
      <h3 style={{ fontSize: 16, color: C.navy, marginBottom: 12 }}>Then and Now</h3>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.lightGray}` }}>
            <th style={{ textAlign: "left", padding: "6px 4px" }}>Dimension</th>
            <th style={{ textAlign: "right", padding: "6px 4px" }}>Baseline</th>
            <th style={{ textAlign: "right", padding: "6px 4px" }}>Debrief</th>
            <th style={{ textAlign: "right", padding: "6px 4px" }}>Change</th>
          </tr>
        </thead>
        <tbody>
          {comparisons.map((c) => {
            const subscale = subscales.find((s) => s.id === c.subscale_id);
            return (
              <tr key={c.subscale_id} style={{ borderBottom: `1px solid ${C.lightGray}` }}>
                <td style={{ padding: "6px 4px" }}>{subscale ? subscale.name : c.subscale_id}</td>
                <td style={{ textAlign: "right", padding: "6px 4px" }}>
                  {c.baseline_mean != null ? c.baseline_mean.toFixed(2) : "--"}
                </td>
                <td style={{ textAlign: "right", padding: "6px 4px" }}>{c.debrief_mean.toFixed(2)}</td>
                <td style={{ textAlign: "right", padding: "6px 4px" }}>
                  {c.delta != null ? (c.delta > 0 ? `+${c.delta.toFixed(2)}` : c.delta.toFixed(2)) : "--"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into ConfirmationScreen**

Find the current `ConfirmationScreen` function signature and its usage:

```jsx
function ConfirmationScreen({ completionText, moduleNum, completionCode }) {
```

Change it to accept two more props:

```jsx
function ConfirmationScreen({ completionText, moduleNum, completionCode, baselineComparison, subscales }) {
```

Find the closing `</div>` of `ConfirmationScreen`'s returned JSX -- specifically, the structure right after the Copy button and its failure message:

```jsx
      {copyState === "failed" && (
        <p role="alert" style={{ color: C.danger, fontSize: 13, marginTop: 8 }}>
          Couldn't copy automatically. Select the code above and copy it manually.
        </p>
      )}
    </div>
  );
}
```

Add the panel between the failure message and the closing `</div>`:

```jsx
      {copyState === "failed" && (
        <p role="alert" style={{ color: C.danger, fontSize: 13, marginTop: 8 }}>
          Couldn't copy automatically. Select the code above and copy it manually.
        </p>
      )}

      {baselineComparison && <ThenAndNowPanel comparisons={baselineComparison} subscales={subscales} />}
    </div>
  );
}
```

Find where `CheckIn` renders `ConfirmationScreen`:

```jsx
{status === "confirmation" && result && (
  <ConfirmationScreen
    completionText={instrument.completion}
    moduleNum={moduleNum}
    completionCode={result.completion_code}
  />
)}
```

Add the two new props:

```jsx
{status === "confirmation" && result && (
  <ConfirmationScreen
    completionText={instrument.completion}
    moduleNum={moduleNum}
    completionCode={result.completion_code}
    baselineComparison={result.baseline_comparison}
    subscales={instrument.subscales}
  />
)}
```

- [ ] **Step 3: Manual verification**

Run `cd client && npm run build` -- confirm it succeeds.

If browser automation is available: complete a full Baseline for a test email on `?week=4&mode=baseline`, note the email used, then complete a full Debrief with the *same* email on `?week=4&mode=debrief`. On the Debrief's confirmation screen, expect a "Then and Now" table with 4 rows (one per subscale), each showing a Baseline mean, a Debrief mean, and a signed delta. Then repeat with a *different*, never-used-before email for the Debrief -- expect the confirmation screen to render normally with no "Then and Now" section at all (since `baseline_comparison` will be absent from the response). This requires a real `DATABASE_URL` to actually exercise (the local dev environment likely doesn't have one by default) -- if you can't complete this live check, do a careful code read-through instead and say so explicitly: confirm `baselineComparison && <ThenAndNowPanel .../>` correctly renders nothing when `result.baseline_comparison` is `undefined`, and confirm the panel's `subscales.find(...)` lookup gracefully falls back to showing the raw `subscale_id` if a subscale somehow isn't found (defensive, shouldn't happen in practice but shouldn't crash either).

- [ ] **Step 4: Commit**

```bash
git add client/src/CheckIn.jsx
git commit -m "feat: add Then and Now panel to the Debrief confirmation screen"
```

---

### Task 11: Documentation

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document the new env vars**

In `.env.example`, find the existing check-in section:

```
# Optional: directory of instrument JSON files (default: server/checkin/instruments)
CHECKIN_INSTRUMENT_DIR=
```

Add immediately after it:

```
# Optional: path to the per-course config file (default: server/checkin/courses.json)
CHECKIN_COURSES_FILE=

# Required for the check-in admin API (verify/summary/export/reload/delete/purge)
# Any long, random string. Sent as the X-Admin-Token header.
CHECKIN_ADMIN_TOKEN=change-me-to-a-long-random-string
```

- [ ] **Step 2: Update the README's Check-In Module section**

Find the existing "Not yet built" paragraph in README.md's "## Check-In Module (Baseline / Debrief)" section:

```markdown
**Not yet built** (see `docs/superpowers/plans/2026-09-13-checkin-module.md`
for the full scope decisions): the admin API (verify/summary/export/delete),
the "then and now" comparison panel, `key`/`none` identity modes, and the
real instrument migration.
```

Replace it with:

```markdown
**Built as of the admin/retention follow-up plan**
(`docs/superpowers/plans/2026-09-13-checkin-admin.md`): the admin API,
`courses.json` (per-course identity mode / retention config), the
automatic retention purge job, and the "then and now" comparison panel on
the Debrief confirmation screen.

**Admin endpoints** (all require an `X-Admin-Token` header matching
`CHECKIN_ADMIN_TOKEN`):
- `GET /api/admin/verify?code=` -- check whether a completion code is real
- `GET /api/admin/summary?course=` -- response counts by module/phase, straightlining counts, last submission time
- `GET /api/admin/export?course=&format=json|csv&shape=long|paired` -- long: one row per item; paired: one row per participant per module with baseline/debrief means and deltas
- `POST /api/admin/instruments/reload` -- re-read the instrument directory without redeploying
- `DELETE /api/admin/participant?participant_id=` -- full erasure (responses and identity) for a right-to-erasure request
- `POST /api/admin/purge-expired` -- the automatic retention job's actual logic; not scheduled by this repo, call it periodically from wherever you want the schedule to live (idempotent, safe to call repeatedly)

**Still not built:** `key`/`none` identity modes (only `email` is
implemented; `courses.json` can declare a different mode but the server
rejects it with 501 until that mode actually exists), the real 18-Google-
Forms-to-9-instrument-files migration (`AL.json` is still the only, still
fixture, instrument), CSP `frame-ancestors` for Canvas iframe embedding,
and the client-side `email_domain_hint` soft warning (the field exists in
`courses.json` but nothing reads it yet).
```

- [ ] **Step 3: Update CLAUDE.md**

In `CLAUDE.md`'s Repository Structure block, find:

```
  checkin/          # Baseline/Debrief check-in module (see README's Check-In Module section)
```

No change needed there -- it already covers the whole `checkin/` directory including the new files. Instead, add a one-line note to the Commands section or wherever seems least disruptive; given the file's current shape, simplest is to leave `CLAUDE.md` as-is for this task, since the README carries the actual endpoint documentation and `CLAUDE.md`'s existing `checkin/` pointer already directs readers there. **Skip this step -- no edit needed.**

- [ ] **Step 4: Commit**

```bash
git add .env.example README.md
git commit -m "docs: document the admin API, courses.json, and retention purge"
```

---

### Task 12: Full-stack smoke test and push

**Files:** none (verification only)

- [ ] **Step 1: Run the full server test suite**

Run: `cd server && npm test`
Expected: all suites pass (107 from the base module + all new tests from this plan).

- [ ] **Step 2: Confirm the client still builds**

Run: `cd client && npm run build`

- [ ] **Step 3: Build and run the full Docker image locally**

```bash
docker build -t sim-checkin-admin-test .
docker run -d --name sim-checkin-admin-test -p 18091:3000 \
  -e ANTHROPIC_API_KEY=test-not-real \
  -e CHECKIN_HMAC_SECRET=local-test-secret \
  -e CHECKIN_AES_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")" \
  -e CHECKIN_ADMIN_TOKEN=local-test-admin-token \
  sim-checkin-admin-test
```

- [ ] **Step 4: Smoke-test the containerized app**

```bash
curl -s -o /dev/null -w "GET / -> %{http_code}\n" http://127.0.0.1:18091/
curl -s -w "\nHTTP %{http_code}\n" http://127.0.0.1:18091/api/instrument/OBLD500/4/baseline | tail -c 100
curl -s -w "\nHTTP %{http_code}\n" http://127.0.0.1:18091/api/admin/summary?course=OBLD500 -H "X-Admin-Token: wrong"
curl -s -w "\nHTTP %{http_code}\n" http://127.0.0.1:18091/api/admin/summary?course=OBLD500 -H "X-Admin-Token: local-test-admin-token"
curl -s -w "\nHTTP %{http_code}\n" -X POST http://127.0.0.1:18091/api/admin/purge-expired -H "X-Admin-Token: local-test-admin-token"
```

Expected: `GET /` 200; `GET /api/instrument/...` 200 with instrument JSON; admin summary with the wrong token 401; with the right token, 503 (no `DATABASE_URL` in this container -- matches the base module's established pattern) rather than a crash; purge-expired likewise 503 without a database, or 200 with a `results` array showing `OBLD500`'s status as `"not yet due"` if you do have a `DATABASE_URL` wired to this container (the 2027-03-14 threshold is far in the future relative to today).

- [ ] **Step 5: Clean up**

```bash
docker rm -f sim-checkin-admin-test
docker rmi sim-checkin-admin-test
```

- [ ] **Step 6: Push the branch**

```bash
git push -u origin feature/checkin-admin
```

Do not open a PR or merge automatically -- hand this off for review first, same as the base module.

---

## Handoff

This plan deliberately stops short of deploying to `sim-prod`, same as the base module. Once all 12 tasks are complete and reviewed:

1. Open a PR from `feature/checkin-admin` into `main`.
2. Deploy the same way the base module was: `az acr build` a new image, `az containerapp update`. This adds exactly one new secret beyond what the base module already wired up: `CHECKIN_ADMIN_TOKEN` (in Key Vault `ldrc-cortex-kv-dev`, alongside the three existing `ldrc-sim-*` check-in secrets).
3. Before relying on `POST /api/admin/purge-expired` for real retention compliance: set up something to actually call it periodically (a scheduled trigger of some kind) -- this plan builds the endpoint but does not schedule it.
4. The real instrument migration and CSP `frame-ancestors` remain the two items not yet started from the original six deferred from the base module's plan.
