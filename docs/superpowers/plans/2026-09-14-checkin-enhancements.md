# Check-In Module Enhancements: Multi-Course Wiring, key/none Identity Modes, CSP, Scheduled Purge

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close four of the remaining gaps in the Check-In Module (already live for OBLD 500 with real content as of 2026-09-14): let the student-facing client actually reach a second course, implement the `key` and `none` identity modes the backend already declares but rejects, add the CSP header Canvas embedding needs, and make the retention purge job actually run on a schedule instead of only on manual call.

**Architecture:** All four items build on infrastructure that already exists and is already reviewed/deployed (`courses.json`, the admin API, `instrumentLoader`/`routes.js`, `identity.js`). No new database tables, no new npm dependencies, no new Azure resources. The scheduling piece is a plain GitHub Actions cron workflow calling the existing `POST /api/admin/purge-expired` endpoint over HTTPS -- no in-process timer, no new infrastructure to provision or pay for.

**Tech Stack:** Same as the rest of Sim -- Node/Express, `pg`, React (no client test framework exists in this repo; client changes are verified by build + live browser testing, matching how the Then-and-Now panel was verified). GitHub Actions for the new scheduled workflow.

**Explicitly out of scope for this plan (per the user's own scope decision, 2026-09-14):** migrating Sim onto the shared `ldrcoach/.github` CI/CD platform. That platform reached v1.0.0 acceptance the same day this plan was written, but Sim isn't yet a consumer (no `.ldrc.yml`) and isn't in its migration scope -- worth revisiting as its own initiative later, not folded in here.

---

## Source-spec deviations (read this before starting)

Grounded against the original `SimuLeader_CheckIn_Module_Spec_v1.md` (`C:\Users\dvwat\Downloads\`), section 4 (identity and pairing) and section 9 (security and privacy). Corrections and scope decisions, not corner-cutting:

1. **CSP `frame-ancestors` is a single, global header**, not gated per-course by `courses.json`'s `allow_embed` field. The spec's own wording ("CSP frame-ancestors set to allow `*.instructure.com` so the instrument can be embedded in Canvas if desired") reads as a blanket policy, and there's a real technical reason it has to be: the server can't know which course a request is "for" at the point it serves the SPA shell (`index.html`) -- the course only becomes known client-side, after the bundle loads and parses the URL. `allow_embed` stays in `courses.json`, unused by Sim's own server (same status as `email_domain_hint` was before this plan) -- it's available for the ICDF/Canvas launch-panel side to consult when deciding whether to embed a given course's check-in at all, which is a decision made outside Sim.
2. **`key` mode's identity input is a single plain text field**, not a two-step "create and confirm" flow. The spec says a learner "creates a memorable participant key on the first Baseline... and re-enters it on every later instrument" -- it doesn't mandate a confirmation UX, and the existing email field is similarly a single input. Matching the codebase's existing minimalism rather than adding UX not asked for.
3. **`none` mode's participant_id is `crypto.randomUUID()`, generated fresh per submission.** The spec says "no identity, no pairing; counts only" without specifying a mechanism -- a fresh random id per submission is the simplest way to satisfy the existing `checkin_responses.participant_id NOT NULL REFERENCES checkin_participants(participant_id)` foreign key (a `checkin_participants` row is still required) while guaranteeing zero possibility of cross-submission pairing, which is the actual requirement.
4. **Multi-course URL param (`?course=`) defaults to `OBLD500`** when absent, so every existing Canvas link (`?week={N}&mode=baseline`, with no `course` param) keeps working unchanged. Not specified in the spec (which predates any second course existing), but the obvious backward-compatible choice.
5. **Retention purge scheduling is a GitHub Actions cron workflow**, not an Azure Container Apps Job or an in-process timer. The spec predates the Azure migration and doesn't specify a mechanism. A GitHub Actions workflow needs no new Azure resource (no cost, no provisioning), is versioned in the repo, supports `workflow_dispatch` for manual testing, and doesn't conflict with the decision to leave the `ldrc-cicd` platform migration out of this plan (a scheduled-task workflow is orthogonal to a deploy pipeline).

---

## File Structure

```
server/
  checkin/
    routes.js          MODIFY: GET /instrument includes identity_mode + email_domain_hint;
                        POST /responses implements key/none identity modes (replacing the 501)
    identity.js          unchanged -- deriveParticipantId is already generic over any string input
  index.js               MODIFY: add the CSP frame-ancestors header
  tests/
    checkin.routes.test.js   MODIFY: new GET /instrument tests, key/none POST /responses tests,
                              new CSP header test, remove the now-obsolete 501 test
client/
  src/
    App.jsx             MODIFY: parseCheckinParams() reads ?course=, defaults to OBLD500
    CheckIn.jsx           MODIFY: course is a prop, not hardcoded; IntroScreen renders an
                          identity-mode-aware field (email/key/none) with the email_domain_hint
                          soft warning; doSubmit sends the right identity shape per mode
.github/
  workflows/
    purge-expired.yml   NEW: daily cron + workflow_dispatch, calls POST /api/admin/purge-expired
.env.example, README.md   MODIFY: document key/none modes, CSP, the scheduled workflow's secret
```

---

### Task 1: Expose identity_mode and email_domain_hint via GET /api/instrument

**Files:**
- Modify: `server/checkin/routes.js`
- Modify: `server/tests/checkin.routes.test.js`

The client needs to know a course's identity mode and email domain hint *before* the learner does anything, so it can render the right field on the intro screen. `courses.js` already has this data (`courses.getCourseConfig(course)`); this task just merges it into the existing public instrument view response.

- [ ] **Step 1: Write the failing tests**

In `server/tests/checkin.routes.test.js`, find the `describe('GET /api/instrument/:course/:module/:phase', ...)` block:

```javascript
describe('GET /api/instrument/:course/:module/:phase', () => {
  let app;
  beforeEach(() => { app = createApp(); });
```

Add a `mockCourseConfig` reset to this `beforeEach` (the module-level `mockCourseConfig` variable already exists near the top of the file, currently only reset in the `POST /api/responses` block's `beforeEach`):

```javascript
describe('GET /api/instrument/:course/:module/:phase', () => {
  let app;
  beforeEach(() => {
    app = createApp();
    mockCourseConfig = { identity_mode: 'email', email_domain_hint: 'erau.edu' };
    mockGetCourseConfig.mockClear();
  });
```

Add two new tests to this same `describe` block, after the existing four:

```javascript
  test('includes identity_mode and email_domain_hint from courses.json', async () => {
    const res = await request(app).get('/api/instrument/OBLD500/4/baseline');
    expect(res.status).toBe(200);
    expect(res.body.identity_mode).toBe('email');
    expect(res.body.email_domain_hint).toBe('erau.edu');
  });

  test('defaults identity_mode to "email" and email_domain_hint to null for an unconfigured course', async () => {
    mockGetCourseConfig.mockReturnValueOnce(null);
    const res = await request(app).get('/api/instrument/OBLD500/4/baseline');
    expect(res.status).toBe(200);
    expect(res.body.identity_mode).toBe('email');
    expect(res.body.email_domain_hint).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx jest tests/checkin.routes.test.js`
Expected: the two new tests fail (`res.body.identity_mode` is `undefined`, not `'email'`).

- [ ] **Step 3: Update routes.js**

Find the `GET /instrument/:course/:module/:phase` handler:

```javascript
router.get('/instrument/:course/:module/:phase', checkinLimiter, (req, res) => {
  const { course, phase } = req.params;
  const moduleNum = Number(req.params.module);

  if (!VALID_PHASES.includes(phase)) {
    return res.status(400).json({ error: 'phase must be "baseline" or "debrief"' });
  }
  if (!Number.isInteger(moduleNum)) {
    return res.status(400).json({ error: 'module must be an integer' });
  }

  const view = instrumentLoader.getPublicView(course, moduleNum, phase);
  if (!view) {
    return res.status(404).json({ error: 'Instrument not found' });
  }
  res.json(view);
});
```

Replace with:

```javascript
router.get('/instrument/:course/:module/:phase', checkinLimiter, (req, res) => {
  const { course, phase } = req.params;
  const moduleNum = Number(req.params.module);

  if (!VALID_PHASES.includes(phase)) {
    return res.status(400).json({ error: 'phase must be "baseline" or "debrief"' });
  }
  if (!Number.isInteger(moduleNum)) {
    return res.status(400).json({ error: 'module must be an integer' });
  }

  const view = instrumentLoader.getPublicView(course, moduleNum, phase);
  if (!view) {
    return res.status(404).json({ error: 'Instrument not found' });
  }

  const courseConfig = courses.getCourseConfig(course);
  view.identity_mode = courseConfig ? courseConfig.identity_mode : 'email';
  view.email_domain_hint = courseConfig ? courseConfig.email_domain_hint : null;

  res.json(view);
});
```

(`courses` is already required at the top of this file -- no new require needed.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx jest tests/checkin.routes.test.js`
Expected: all tests in the `GET /api/instrument` block pass, including the 2 new ones.

- [ ] **Step 5: Run the full suite**

Run: `cd server && npm test`
Expected: zero regressions (baseline going into this task is 183 passing; treat the actual output as authoritative over this arithmetic).

- [ ] **Step 6: Commit**

```bash
git add server/checkin/routes.js server/tests/checkin.routes.test.js
git commit -m "feat: expose identity_mode and email_domain_hint via GET /api/instrument"
```

Add a blank line then `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer to the commit message.

---

### Task 2: Implement key and none identity modes

**Files:**
- Modify: `server/checkin/routes.js`
- Modify: `server/tests/checkin.routes.test.js`

Replaces the current hard `501` for any `identity_mode` other than `'email'` with real support for `key` and `none`, per the spec's section 4.

- [ ] **Step 1: Write the failing tests**

In `server/tests/checkin.routes.test.js`, find and DELETE this existing test (it tests behavior this task removes):

```javascript
  test('returns 501 when the configured identity_mode is not "email"', async () => {
    mockCourseConfig = { identity_mode: 'key' };
    const res = await request(app).post('/api/responses').send(validBaselineBody());
    expect(res.status).toBe(501);
    expect(mockInsertResponse).not.toHaveBeenCalled();
  });
```

Add these tests in its place, in the same `describe('POST /api/responses', ...)` block:

```javascript
  test('accepts a valid key-mode submission and derives participant_id from the key', async () => {
    mockCourseConfig = { identity_mode: 'key' };
    // identity: { key: ... } fully replaces validBaselineBody()'s identity: { email: ... }
    // (object-literal override, not a merge) -- no email field is present in this body.
    const body = { ...validBaselineBody(), identity: { key: 'blue-elephant-42' } };
    const res = await request(app).post('/api/responses').send(body);
    expect(res.status).toBe(200);
    expect(mockUpsertParticipant).toHaveBeenCalledTimes(1);
    const [participantId, emailEncrypted, identityMode] = mockUpsertParticipant.mock.calls[0];
    expect(participantId).toMatch(/^[a-f0-9]{64}$/); // HMAC-SHA256 hex digest
    expect(emailEncrypted).toBeNull();
    expect(identityMode).toBe('key');
  });

  test('derives the same participant_id for the same key across calls', async () => {
    mockCourseConfig = { identity_mode: 'key' };
    const body = { ...validBaselineBody(), identity: { key: 'blue-elephant-42' } };
    await request(app).post('/api/responses').send(body);
    await request(app).post('/api/responses').send(body);
    const firstId = mockUpsertParticipant.mock.calls[0][0];
    const secondId = mockUpsertParticipant.mock.calls[1][0];
    expect(firstId).toBe(secondId);
  });

  test('returns 400 for key mode when identity.key is missing', async () => {
    mockCourseConfig = { identity_mode: 'key' };
    const body = { ...validBaselineBody() };
    delete body.identity;
    const res = await request(app).post('/api/responses').send(body);
    expect(res.status).toBe(400);
    expect(mockInsertResponse).not.toHaveBeenCalled();
  });

  test('returns 400 for key mode when identity.key is shorter than 3 characters', async () => {
    mockCourseConfig = { identity_mode: 'key' };
    const body = { ...validBaselineBody(), identity: { key: 'ab' } };
    const res = await request(app).post('/api/responses').send(body);
    expect(res.status).toBe(400);
  });

  test('returns 400 for key mode when identity.key is longer than 100 characters', async () => {
    mockCourseConfig = { identity_mode: 'key' };
    const body = { ...validBaselineBody(), identity: { key: 'x'.repeat(101) } };
    const res = await request(app).post('/api/responses').send(body);
    expect(res.status).toBe(400);
  });

  test('accepts a valid none-mode submission with no identity field', async () => {
    mockCourseConfig = { identity_mode: 'none' };
    const body = { ...validBaselineBody() };
    delete body.identity;
    const res = await request(app).post('/api/responses').send(body);
    expect(res.status).toBe(200);
    expect(mockUpsertParticipant).toHaveBeenCalledTimes(1);
    const [participantId, emailEncrypted, identityMode] = mockUpsertParticipant.mock.calls[0];
    expect(typeof participantId).toBe('string');
    expect(participantId.length).toBeGreaterThan(0);
    expect(emailEncrypted).toBeNull();
    expect(identityMode).toBe('none');
  });

  test('generates a different participant_id for each none-mode submission (no pairing)', async () => {
    mockCourseConfig = { identity_mode: 'none' };
    const body = { ...validBaselineBody() };
    delete body.identity;
    await request(app).post('/api/responses').send(body);
    await request(app).post('/api/responses').send(body);
    const firstId = mockUpsertParticipant.mock.calls[0][0];
    const secondId = mockUpsertParticipant.mock.calls[1][0];
    expect(firstId).not.toBe(secondId);
  });

  test('still returns 501 for an identity_mode outside email/key/none', async () => {
    // Defensive coverage: courses.js's own validator restricts identity_mode to
    // email/key/none, so this path isn't reachable via real config today -- but
    // routes.js shouldn't silently misbehave if that ever changes.
    mockCourseConfig = { identity_mode: 'sso' };
    const res = await request(app).post('/api/responses').send(validBaselineBody());
    expect(res.status).toBe(501);
    expect(mockInsertResponse).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx jest tests/checkin.routes.test.js`
Expected: the new key/none tests fail (still hitting the old 501-for-everything-but-email branch); the deleted 501 test is simply gone.

- [ ] **Step 3: Add the isValidKey helper and update routes.js**

In `server/checkin/routes.js`, add `const crypto = require('crypto');` to the requires at the top:

```javascript
const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const instrumentLoader = require('./instrumentLoader');
const identity = require('./identity');
const completionCode = require('./completionCode');
const scoring = require('./scoring');
const checkinDb = require('./db');
const courses = require('./courses');
```

Add `isValidKey` next to the existing `isValidEmail`:

```javascript
function isValidEmail(email) {
  if (typeof email !== 'string' || email.length === 0 || email.length > 254) return false;
  if (/\s/.test(email)) return false;
  const atIndex = email.indexOf('@');
  if (atIndex <= 0 || atIndex !== email.lastIndexOf('@')) return false; // exactly one @, not at the start
  const domain = email.slice(atIndex + 1);
  const dotIndex = domain.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === domain.length - 1) return false; // dot present, not at domain's edges
  return true;
}

function isValidKey(key) {
  if (typeof key !== 'string') return false;
  const trimmed = key.trim();
  return trimmed.length >= 3 && trimmed.length <= 100;
}
```

Find the current identity-mode gate inside `router.post('/responses', ...)`:

```javascript
    if (!ident || !isValidEmail(ident.email)) {
      return res.status(400).json({ error: 'identity.email is required and must be a valid email' });
    }
    if (!started_at || typeof started_at !== 'string') {
      return res.status(400).json({ error: 'started_at is required' });
    }
    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'answers object is required' });
    }

    const courseConfig = courses.getCourseConfig(course);
    const identityMode = courseConfig ? courseConfig.identity_mode : 'email';
    if (identityMode !== 'email') {
      return res.status(501).json({ error: `identity_mode "${identityMode}" is not yet implemented` });
    }
```

Replace with:

```javascript
    if (!started_at || typeof started_at !== 'string') {
      return res.status(400).json({ error: 'started_at is required' });
    }
    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'answers object is required' });
    }

    const courseConfig = courses.getCourseConfig(course);
    const identityMode = courseConfig ? courseConfig.identity_mode : 'email';

    if (identityMode === 'email') {
      if (!ident || !isValidEmail(ident.email)) {
        return res.status(400).json({ error: 'identity.email is required and must be a valid email' });
      }
    } else if (identityMode === 'key') {
      if (!ident || !isValidKey(ident.key)) {
        return res.status(400).json({ error: 'identity.key is required and must be between 3 and 100 characters' });
      }
    } else if (identityMode !== 'none') {
      return res.status(501).json({ error: `identity_mode "${identityMode}" is not yet implemented` });
    }
    // 'none' mode requires no identity field at all -- any submitted `identity` is ignored.
```

Find the participant-id derivation, later in the same handler:

```javascript
    const participantId = identity.deriveParticipantId(ident.email, process.env.CHECKIN_HMAC_SECRET);
    const emailEncrypted = identity.encryptEmail(ident.email, process.env.CHECKIN_AES_KEY);
    await checkinDb.upsertParticipant(participantId, emailEncrypted, identityMode);
```

Replace with:

```javascript
    let participantId;
    let emailEncrypted = null;
    if (identityMode === 'email') {
      participantId = identity.deriveParticipantId(ident.email, process.env.CHECKIN_HMAC_SECRET);
      emailEncrypted = identity.encryptEmail(ident.email, process.env.CHECKIN_AES_KEY);
    } else if (identityMode === 'key') {
      // deriveParticipantId is generic over any string input (trim + lowercase,
      // then HMAC) -- the same function works for a key exactly as it does for
      // an email, with no changes needed to identity.js.
      participantId = identity.deriveParticipantId(ident.key, process.env.CHECKIN_HMAC_SECRET);
    } else {
      // 'none': no persistent identity, no pairing across submissions -- a
      // fresh random id every time. checkin_participants still needs a row
      // (checkin_responses.participant_id is a NOT NULL foreign key to it).
      participantId = crypto.randomUUID();
    }
    await checkinDb.upsertParticipant(participantId, emailEncrypted, identityMode);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx jest tests/checkin.routes.test.js`

- [ ] **Step 5: Run the full suite**

Run: `cd server && npm test`
Expected: zero regressions.

- [ ] **Step 6: Commit**

```bash
git add server/checkin/routes.js server/tests/checkin.routes.test.js
git commit -m "feat: implement key and none identity modes"
```

Add a blank line then `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer to the commit message.

---

### Task 3: CSP frame-ancestors header

**Files:**
- Modify: `server/index.js`
- Modify: `server/tests/checkin.routes.test.js`

**Files:**
- Modify: `server/index.js`
- Modify: `server/tests/checkin.routes.test.js`

- [ ] **Step 1: Write the failing test**

In `server/tests/checkin.routes.test.js`, add a new `describe` block after the existing `describe('Task 9 regression: check-in router does not affect other /api routes', ...)` block (this file already requires `../index` via `createApp()`, so it's the natural home for an app-wide header test):

```javascript
describe('Content-Security-Policy header', () => {
  test('sets frame-ancestors to allow Canvas embedding, on every response', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.headers['content-security-policy']).toBe("frame-ancestors 'self' https://*.instructure.com");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx jest tests/checkin.routes.test.js`
Expected: FAIL -- `res.headers['content-security-policy']` is `undefined`.

- [ ] **Step 3: Update index.js**

Find:

```javascript
const app = express();
const PORT = process.env.PORT || 3000;

// Azure Container Apps ingress sits in front of us as a single reverse proxy
// hop; trust its X-Forwarded-For so express-rate-limit keys on the real
// client IP instead of the proxy's.
app.set('trust proxy', 1);

app.use('/api/admin', adminRoutes);
```

Replace with:

```javascript
const app = express();
const PORT = process.env.PORT || 3000;

// Azure Container Apps ingress sits in front of us as a single reverse proxy
// hop; trust its X-Forwarded-For so express-rate-limit keys on the real
// client IP instead of the proxy's.
app.set('trust proxy', 1);

// Allow Canvas (ICDF) to embed the check-in flow in an iframe if a course
// chooses to; default delivery is still a link that opens in a new tab. This
// is a single, global policy -- courses.json's per-course allow_embed field
// is consulted by the ICDF/Canvas launch-panel side, not by this header,
// since the server can't know which course a request is "for" until the
// client-side bundle parses the URL.
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://*.instructure.com");
  next();
});

app.use('/api/admin', adminRoutes);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && npx jest tests/checkin.routes.test.js`

- [ ] **Step 5: Run the full suite**

Run: `cd server && npm test`
Expected: zero regressions.

- [ ] **Step 6: Commit**

```bash
git add server/index.js server/tests/checkin.routes.test.js
git commit -m "feat: add CSP frame-ancestors header for Canvas embedding"
```

Add a blank line then `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer to the commit message.

---

### Task 4: Client -- multi-course wiring, identity-mode-aware intro screen, email_domain_hint warning

**Files:**
- Modify: `client/src/App.jsx`
- Modify: `client/src/CheckIn.jsx`

There is no client-side test framework in this repo (confirmed: no test script in `client/package.json`, no `*.test.*` files under `client/`). Verification is `npm run build` plus live browser testing, matching how the Then-and-Now panel (an earlier task in this same codebase) was verified.

- [ ] **Step 1: Read the current files first**

Read the full current `client/src/App.jsx` (specifically `parseCheckinParams()` and the `<CheckIn .../>` render call) and `client/src/CheckIn.jsx` in this worktree before editing -- do not assume either matches any older version. The exact current content of the relevant sections is reproduced in the steps below, but this file has been edited by several prior tasks in this codebase's history; verify against the real file.

- [ ] **Step 2: Update App.jsx**

Find:

```javascript
function parseCheckinParams() {
  const params = new URLSearchParams(window.location.search);
  const week = params.get("week");
  const mode = params.get("mode");
  if (week && (mode === "baseline" || mode === "debrief")) {
    return { moduleNum: Number(week), phase: mode };
  }
  return null;
}
```

Replace with:

```javascript
function parseCheckinParams() {
  const params = new URLSearchParams(window.location.search);
  const week = params.get("week");
  const mode = params.get("mode");
  const course = params.get("course") || "OBLD500";
  if (week && (mode === "baseline" || mode === "debrief")) {
    return { moduleNum: Number(week), phase: mode, course };
  }
  return null;
}
```

Find:

```javascript
      {view === "checkin" && checkinParams && (
        <CheckIn moduleNum={checkinParams.moduleNum} phase={checkinParams.phase} />
      )}
```

Replace with:

```javascript
      {view === "checkin" && checkinParams && (
        <CheckIn moduleNum={checkinParams.moduleNum} phase={checkinParams.phase} course={checkinParams.course} />
      )}
```

- [ ] **Step 3: Update CheckIn.jsx -- add isValidKey and emailDomainMatches helpers**

Add these two functions right after the existing `isValidEmail`:

```javascript
function isValidEmail(email) {
  if (typeof email !== "string" || email.length === 0 || email.length > 254) return false;
  if (/\s/.test(email)) return false;
  const atIndex = email.indexOf("@");
  if (atIndex <= 0 || atIndex !== email.lastIndexOf("@")) return false;
  const domain = email.slice(atIndex + 1);
  const dotIndex = domain.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === domain.length - 1) return false;
  return true;
}

function isValidKey(key) {
  if (typeof key !== "string") return false;
  const trimmed = key.trim();
  return trimmed.length >= 3 && trimmed.length <= 100;
}

function emailDomainMatches(email, hint) {
  if (!hint) return true;
  const at = email.lastIndexOf("@");
  if (at === -1) return true; // let the hard validator handle malformed input
  return email.slice(at + 1).toLowerCase() === hint.toLowerCase();
}
```

- [ ] **Step 4: Rewrite IntroScreen**

Find the entire current `IntroScreen` function (from `function IntroScreen({ instrument, moduleNum, phase, email, setEmail, onStart }) {` through its closing `}`) and replace it with:

```jsx
function IntroScreen({ instrument, moduleNum, phase, identityValue, setIdentityValue, onStart }) {
  const [touched, setTouched] = useState(false);
  const identityMode = instrument.identity_mode || "email";
  const trimmedValue = identityValue.trim();
  const identityValid =
    identityMode === "email" ? isValidEmail(trimmedValue) :
    identityMode === "key" ? isValidKey(trimmedValue) :
    true; // 'none' has no identity field to validate
  const domainMismatch =
    identityMode === "email" && trimmedValue && isValidEmail(trimmedValue) &&
    !emailDomainMatches(trimmedValue, instrument.email_domain_hint);

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px" }}>
      <h1 style={{ fontSize: 24, color: C.navy, marginBottom: 4 }}>
        Module {moduleNum}: {instrument.topic}
      </h1>
      <p style={{ color: C.midGray, marginBottom: 20, textTransform: "capitalize" }}>
        {phase} Check-In
      </p>
      <p style={{ lineHeight: 1.6, marginBottom: 20 }}>{instrument.intro}</p>

      <div style={{ background: C.lightGray, borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <strong style={{ display: "block", marginBottom: 8 }}>Response scale</strong>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 13, color: C.textSec }}>
          {instrument.scale.labels.map((label) => (
            <span key={label} style={{ background: C.white, padding: "4px 8px", borderRadius: 4 }}>
              {label}
            </span>
          ))}
        </div>
      </div>

      {identityMode !== "none" && (
        <>
          <label htmlFor="checkin-identity" style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
            {identityMode === "key" ? "Create a memorable phrase (e.g., first pet + birth month)" : "Your ERAU email"}
          </label>
          <input
            id="checkin-identity"
            type={identityMode === "key" ? "text" : "email"}
            value={identityValue}
            onChange={(e) => setIdentityValue(e.target.value)}
            onBlur={() => setTouched(true)}
            style={{
              width: "100%", padding: 12, fontSize: 16, borderRadius: 6,
              border: `1px solid ${touched && !identityValid ? C.danger : C.lightGray}`,
              marginBottom: 6,
            }}
            aria-describedby={
              [touched && !identityValid ? "identity-error" : null, domainMismatch ? "identity-domain-warning" : null]
                .filter(Boolean).join(" ") || undefined
            }
          />
          {touched && !identityValid && (
            <p id="identity-error" style={{ color: C.danger, fontSize: 13, marginBottom: 12 }}>
              {identityMode === "key"
                ? "Enter a phrase between 3 and 100 characters."
                : "Enter a valid email address."}
            </p>
          )}
          {!(touched && !identityValid) && domainMismatch && (
            <p id="identity-domain-warning" style={{ color: C.textSec, fontSize: 13, marginBottom: 12 }}>
              This doesn't look like your {instrument.email_domain_hint} email. Double-check before continuing.
            </p>
          )}
        </>
      )}

      <p style={{ fontSize: 13, color: C.midGray, margin: "16px 0" }}>
        Your responses are stored by LDRC for course measurement and are not
        part of your grade. See the{" "}
        <a href="/privacy" target="_blank" rel="noreferrer">privacy statement</a>.
      </p>
      <p style={{ fontSize: 13, color: C.midGray, marginBottom: 20 }}>
        Please complete this in one sitting, about eight minutes. A page
        refresh will lose your answers.
      </p>

      <button
        onClick={onStart}
        disabled={!identityValid}
        style={{
          padding: "12px 28px", fontSize: 16, borderRadius: 6, border: "none",
          background: identityValid ? C.navy : C.lightGray,
          color: identityValid ? C.white : C.midGray,
          cursor: identityValid ? "pointer" : "not-allowed",
          minHeight: 44,
        }}
      >
        Start
      </button>
    </div>
  );
}
```

Note the domain-mismatch warning and the hard validation error are mutually exclusive in the UI (`!(touched && !identityValid) && domainMismatch`) -- a malformed email shows the hard error; a well-formed-but-wrong-domain email shows the soft warning instead, never both at once.

- [ ] **Step 5: Update the CheckIn component -- course prop, identityValue state, doSubmit body**

Find:

```javascript
export default function CheckIn({ moduleNum, phase }) {
  const course = "OBLD500";
  const [status, setStatus] = useState("loading"); // loading | error | intro | subscale
  const [errorMessage, setErrorMessage] = useState("");
  const [instrument, setInstrument] = useState(null);
  const [email, setEmail] = useState("");
```

Replace with:

```javascript
export default function CheckIn({ moduleNum, phase, course }) {
  const [status, setStatus] = useState("loading"); // loading | error | intro | subscale
  const [errorMessage, setErrorMessage] = useState("");
  const [instrument, setInstrument] = useState(null);
  const [identityValue, setIdentityValue] = useState("");
```

Find `doSubmit`'s body construction:

```javascript
      const body = {
        course,
        module: moduleNum,
        phase,
        identity: { email: email.trim() },
        started_at: startedAt,
        answers,
        ...(phase === "debrief" ? { extras: { post_experience: pxAnswers, open_ended: openAnswers } } : {}),
      };
```

Replace with:

```javascript
      const identityMode = instrument.identity_mode || "email";
      const identity =
        identityMode === "email" ? { email: identityValue.trim() } :
        identityMode === "key" ? { key: identityValue.trim() } :
        null;
      const body = {
        course,
        module: moduleNum,
        phase,
        identity,
        started_at: startedAt,
        answers,
        ...(phase === "debrief" ? { extras: { post_experience: pxAnswers, open_ended: openAnswers } } : {}),
      };
```

Find the `IntroScreen` render call:

```javascript
      {status === "intro" && (
        <IntroScreen
          instrument={instrument}
          moduleNum={moduleNum}
          phase={phase}
          email={email}
          setEmail={setEmail}
          onStart={() => { setStartedAt(new Date().toISOString()); setStatus("subscale"); }}
        />
      )}
```

Replace with:

```javascript
      {status === "intro" && (
        <IntroScreen
          instrument={instrument}
          moduleNum={moduleNum}
          phase={phase}
          identityValue={identityValue}
          setIdentityValue={setIdentityValue}
          onStart={() => { setStartedAt(new Date().toISOString()); setStatus("subscale"); }}
        />
      )}
```

- [ ] **Step 6: Verify the build succeeds**

Run: `cd client && npm run build`
Expected: no errors.

- [ ] **Step 7: Live manual verification**

Use the Claude Browser tools for this. As with the Then-and-Now panel task, this requires a real Postgres connection to exercise `POST /api/responses` end to end -- check for an available `DATABASE_URL`/Docker the same way; if none is available and Docker is, spin up an ephemeral `postgres:16-alpine` container the same way prior tasks in this codebase did.

You'll need a second course configured to test multi-course wiring and the non-email identity modes, since `courses.json` currently only has `OBLD500` (which is `email` mode). Do NOT modify the real `server/checkin/instruments/` or `server/checkin/courses.json` files for this -- instead, set `CHECKIN_COURSES_FILE` and `CHECKIN_INSTRUMENT_DIR` environment variables to point at a temporary directory you create under your scratchpad, containing:
- A `courses.json` with two entries: `OBLD500` (copy the real one, `identity_mode: "email"`) and a synthetic `TESTCRS` entry with `identity_mode: "key"`, plus your own third synthetic entry with `identity_mode: "none"` if you want to test all three modes (or reuse `TESTCRS` for `key` and add a `TESTCRS2` for `none`).
- Instrument JSON file(s) for those test courses -- the simplest approach is to copy `server/checkin/instruments/AL.json`, changing only the top-level `course` field to match your test course code (`TESTCRS`), for each test course.

Verify, in the live browser:
1. `?week=4&mode=baseline` (no `course` param) still launches OBLD500's real Active Listening check-in, email field, exactly as before this task (backward compatibility).
2. `?week=4&mode=baseline&course=TESTCRS` (key mode) shows the "Create a memorable phrase" field instead of an email field; typing fewer than 3 characters and blurring shows the length-validation error; typing a valid phrase and submitting succeeds; submitting the exact same phrase again for a debrief lands the same participant (if you also test a debrief flow) so pairing still works within key mode.
3. If you configured a `none`-mode test course: the intro screen shows no identity field at all, and the Start button is enabled immediately.
4. For the `email`-mode course, type an email with a domain that doesn't match `email_domain_hint` (if you set one on your test course) -- confirm the soft warning appears and does NOT block the Start button, unlike the hard validation error for a malformed email.
5. Inspect the network response for `GET /api/instrument/...` and confirm it now includes `identity_mode`/`email_domain_hint` fields.

Report exactly what you were able to verify live vs. by code read-through, being honest about which is which -- same standard as prior client-side tasks in this codebase.

Clean up the ephemeral Postgres container and any temporary instrument/course files under your scratchpad when done; do not leave them in the repo.

- [ ] **Step 8: Commit**

```bash
git add client/src/App.jsx client/src/CheckIn.jsx
git commit -m "feat: multi-course URL param, key/none identity mode UI, email_domain_hint warning"
```

Add a blank line then `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer to the commit message.

---

### Task 5: Scheduled retention purge

**Files:**
- Create: `.github/workflows/purge-expired.yml`

**Files:** none in `server/` or `client/` -- this task adds one new workflow file only.

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/purge-expired.yml`:

```yaml
name: Retention purge (Check-In Module)

on:
  schedule:
    # 09:17 UTC daily -- off the hour, to avoid GitHub Actions' scheduling
    # pile-up at exact hour/half-hour marks.
    - cron: '17 9 * * *'
  workflow_dispatch: {}

jobs:
  purge-expired:
    runs-on: ubuntu-latest
    steps:
      - name: Call POST /api/admin/purge-expired
        env:
          CHECKIN_ADMIN_TOKEN: ${{ secrets.CHECKIN_ADMIN_TOKEN }}
        run: |
          response=$(curl -sS -w "\n%{http_code}" -X POST \
            https://sim.ldrcoach.com/api/admin/purge-expired \
            -H "X-Admin-Token: $CHECKIN_ADMIN_TOKEN")
          status="${response##*$'\n'}"
          body="${response%$'\n'*}"
          echo "$body"
          if [ "$status" != "200" ]; then
            echo "purge-expired returned HTTP $status"
            exit 1
          fi
```

This calls the already-built, already-deployed, already-idempotent `POST /api/admin/purge-expired` endpoint over HTTPS -- no app code changes, no new dependency. The job fails loudly (non-zero exit) if the endpoint doesn't return 200, so a broken purge shows up as a red check in the Actions tab rather than failing silently.

- [ ] **Step 2: This workflow needs a repo secret that doesn't exist yet -- flag it, don't set it unilaterally**

`CHECKIN_ADMIN_TOKEN` needs to exist as a GitHub Actions repository secret on `ldrcoach/sim` for this workflow to authenticate. This is the SAME token value already generated and deployed to `sim-prod`'s Key Vault earlier (as `ldrc-sim-checkin-admin-token`) -- do not generate a new one; using a different token here would just make this workflow permanently fail with 401.

This is persistent, standing configuration (a new repository secret) -- per this project's own standing rules, this needs the user's explicit go-ahead before being created, even though setting a repo secret via `gh secret set` is a "regular," easily-reversible action. When you reach this step during execution, stop and ask the user to either (a) authorize you to run `gh secret set CHECKIN_ADMIN_TOKEN --repo ldrcoach/sim` with the existing token value, or (b) set it themselves via the GitHub UI (Settings -> Secrets and variables -> Actions -> New repository secret). Do not proceed to Step 3's verification until this secret exists.

- [ ] **Step 3: Verify manually**

Once the secret exists (and this workflow file is merged to `main` -- `workflow_dispatch` and `schedule` triggers only work from the default branch, not from a feature branch), trigger it manually:

```bash
gh workflow run purge-expired.yml
```

Wait a few seconds, then check the run:

```bash
gh run list --workflow=purge-expired.yml --limit 1
```

Expected: the run succeeds (green check). If it fails, check the run's logs (`gh run view <run-id> --log`) -- a 401 means the secret value doesn't match what's actually in Key Vault/deployed to `sim-prod`; any other non-200 means something else is wrong with the deployed admin API itself (unlikely, since it's already been verified working in production).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/purge-expired.yml
git commit -m "feat: schedule the retention purge job via GitHub Actions"
```

Add a blank line then `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer to the commit message.

---

### Task 6: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the Check-In Module section**

In `README.md`'s "## Check-In Module (Baseline / Debrief)" section, find the "**Still not built:**" paragraph (added by the admin/retention follow-up plan):

```markdown
**Still not built:** `key`/`none` identity modes (only `email` is
implemented; `courses.json` can declare a different mode but the server
rejects it with 501 until that mode actually exists), the real 18-Google-
Forms-to-9-instrument-files migration (`AL.json` is still the only, still
fixture, instrument), CSP `frame-ancestors` for Canvas iframe embedding,
and the client-side `email_domain_hint` soft warning (the field exists in
`courses.json` but nothing reads it yet).
```

Replace with:

```markdown
**Identity modes:** all three from the spec are implemented -- `email`
(ERAU email, encrypted at rest, used for Baseline/Debrief pairing and the
retention purge), `key` (a learner-chosen memorable phrase, 3-100
characters, no email stored, pairing depends on the learner remembering
their own phrase), and `none` (no identity field at all, no pairing
possible, response counts only). A course's `identity_mode` (in
`courses.json`) determines which one a learner sees on the intro screen.

**Multi-course:** the URL scheme is now `?week={N}&mode=baseline&course={CODE}`
-- `course` defaults to `OBLD500` when omitted, so every existing Canvas
link keeps working unchanged. Any course with an entry in `courses.json`
and matching instrument files under `server/checkin/instruments/` (keyed
by `course` + `module` inside each file, not by filename) can be reached
this way.

**CSP:** `frame-ancestors 'self' https://*.instructure.com` is set on
every response, so Canvas can iframe-embed the check-in flow if a course
chooses to; the default delivery is still a link that opens in a new tab.
`courses.json`'s `allow_embed` field is for the ICDF/Canvas launch-panel
side to consult when deciding whether to actually embed a given course --
Sim's own CSP header doesn't vary per course.

**Retention purge scheduling:** `.github/workflows/purge-expired.yml` calls
`POST /api/admin/purge-expired` daily via cron (and supports manual
`workflow_dispatch` runs). Needs a `CHECKIN_ADMIN_TOKEN` GitHub Actions
repository secret matching the token already deployed to `sim-prod`.

**Still not built:** the real 18-Google-Forms-to-9-instrument-files
migration is done (all 9 OBLD 500 modules have real content as of
2026-09-14); nothing else from the original spec remains outstanding for
Sim's side. The ICDF engine's own Baseline/Debrief pages still embed
Google Forms directly and need their launch-panel changed to link to Sim
instead -- that's ICDF-repo work, not Sim's.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document key/none identity modes, multi-course URLs, CSP, and scheduled purge"
```

Add a blank line then `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer to the commit message.

---

### Task 7: Full-stack smoke test and push

**Files:** none (verification only)

- [ ] **Step 1: Run the full server test suite**

Run: `cd server && npm test`
Expected: all suites pass (baseline going into this plan was 183 -- expect roughly 183 + ~2 (Task 1) + ~8 (Task 2) + 1 (Task 3) = ~194; treat the actual output as authoritative over this arithmetic).

- [ ] **Step 2: Confirm the client still builds**

Run: `cd client && npm run build`

- [ ] **Step 3: Full Docker smoke test**

Same pattern as every prior deploy-adjacent task in this codebase:

```bash
docker build -t sim-checkin-enhancements-test .
docker run -d --name sim-checkin-enhancements-test -p 18092:3000 \
  -e ANTHROPIC_API_KEY=test-not-real \
  -e CHECKIN_HMAC_SECRET=local-test-secret \
  -e CHECKIN_AES_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")" \
  -e CHECKIN_ADMIN_TOKEN=local-test-admin-token \
  sim-checkin-enhancements-test
```

```bash
curl -s -o /dev/null -w "GET / -> %{http_code}\n" http://127.0.0.1:18092/
curl -s -I http://127.0.0.1:18092/ | grep -i content-security-policy
curl -s http://127.0.0.1:18092/api/instrument/OBLD500/4/baseline | node -e "
let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
  const j = JSON.parse(d);
  console.log('identity_mode:', j.identity_mode);
  console.log('email_domain_hint:', j.email_domain_hint);
});"
```

Expected: `GET /` 200; the CSP header present with the expected value; the instrument response includes `identity_mode: "email"` and `email_domain_hint: "erau.edu"` for OBLD500.

- [ ] **Step 4: Clean up**

```bash
docker rm -f sim-checkin-enhancements-test
docker rmi sim-checkin-enhancements-test
```

- [ ] **Step 5: Push the branch**

```bash
git push -u origin feature/checkin-enhancements
```

Per this project's own standing preference, open a PR immediately after pushing (don't wait to be asked):

```bash
gh pr create --base main --head feature/checkin-enhancements \
  --title "Multi-course wiring, key/none identity modes, CSP, scheduled retention purge"
```

Do not merge or deploy -- same deliberate stopping point as every other piece of this module. The `CHECKIN_ADMIN_TOKEN` GitHub Actions secret (Task 5, Step 2) still needs to be confirmed set before the scheduled workflow can actually run, even after this PR merges.

---

## Handoff

Once this PR is reviewed, merged, and deployed (same manual `az acr build` + `az containerapp update` process as every other Sim deploy so far -- no new secrets needed for the app itself, since this plan adds no new env vars beyond what's already in Key Vault):

1. Confirm the `CHECKIN_ADMIN_TOKEN` GitHub Actions repository secret is set (Task 5) -- the scheduled purge workflow silently does nothing useful until it is.
2. To actually add a second course, someone needs to: add an entry to `server/checkin/courses.json`, add that course's instrument files under `server/checkin/instruments/` (9 modules' worth, same validation rules as OBLD 500's), and share the resulting `?course={CODE}` launch links. None of that requires touching this plan's code again -- it's all data/config, following the same pattern OBLD 500 itself already uses.
3. Nothing in this plan changes what the ICDF engine's own Baseline/Debrief pages do -- they still need their own change (replacing embedded Google Forms with a launch panel to Sim) to actually take advantage of any of this, per the original spec's section 11 and the user's own relayed note.
