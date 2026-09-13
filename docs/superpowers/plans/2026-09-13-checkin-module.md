# Check-In Module (v0.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 18 Google Forms baseline/debrief instruments for OBLD 500 with a check-in module inside Sim: learners answer a 20-item instrument (plus, on Debrief, 5 post-experience items and 3 open-ended prompts), get a completion code to paste into Canvas, and responses persist to Postgres.

**Architecture:** New `server/checkin/` module (validator, instrument loader, identity/HMAC, completion codes, scoring, Postgres queries, Express router) mounted into the existing `server/index.js`. New `client/src/CheckIn.jsx` learner-facing flow, wired into `App.jsx`'s view switch via a `?week=N&mode=baseline|debrief` URL. No SQLite: this plan stores everything in the `sim` Postgres database already running on `resolver-pg-prod` (the same database this session wired up for session persistence), because Sim's Azure Container Apps filesystem is ephemeral and a local SQLite file would not survive a redeploy.

**Tech Stack:** Node/Express (existing `pg` dependency, no new server dependency), React (no new client dependency), Node's built-in `crypto` for HMAC/AES.

---

## Source-spec deviations (read this before starting)

The source document (`SimuLeader_Check-In_Module_Spec_v1.md`, provided by Dr. Watkins) assumes things about this codebase that turned out not to be true. This plan corrects them; if you are comparing against the original spec, these are deliberate, not oversights:

1. **Storage is Postgres, not SQLite.** Spec section 7 assumed a droplet with a persistent disk (`better-sqlite3`, "nightly copy to the droplet's backup volume"). Sim runs on Azure Container Apps Consumption plan, whose filesystem is wiped on every redeploy/restart. This plan adds tables to the `sim` Postgres database on `resolver-pg-prod` instead (same database + pattern already used for `sim_sessions`/`sim_scores`/`sim_transcripts`). Confirmed working and load-tested by hand in the 2026-09-13 restart session.
2. **Table names are prefixed `checkin_`**, not the spec's bare `instruments`/`participants`/`responses`/`response_items`/`subscale_scores`. These tables now share a database with Sim's own session tables; bare names risk collision and are less self-documenting in a shared DB.
3. **No entry-URL precedent exists.** Spec section 5 claims the `?week={N}&mode=baseline` URL is "consistent with the existing scenario links." It is not: `client/src/App.jsx` has no query-string handling at all today (`view` is pure internal React state, no router, no `URLSearchParams` anywhere in the file). This plan adds the query-param entry point from scratch.
4. **Scope is v0.1 only**, matching the spec's own rollout (section 14): instrument loader/validator, the learner flow, `POST /api/responses` with completion code, and storage. Explicitly **not** in this plan (left for later, separate plans):
   - Admin API (`verify`, `summary`, `export`, `reload`, participant deletion) -- spec's own v0.2.
   - The "then and now" Baseline-vs-Debrief comparison panel on the confirmation screen -- spec's own v0.3.
   - Migrating the real 18 Google Forms into 9 production instrument JSON files -- spec's own separate "Migration" rollout line, deliberately after v0.1-v0.3.
   - `key` and `none` identity modes, and the `courses.json` config file -- spec section 15's open question 1 (email vs. key) is unanswered; only `email` (the stated OBLD 500 default) is built. Wiring a config file to switch between modes that don't exist yet is premature.
   - `CHECKIN_ADMIN_TOKEN` and `CHECKIN_DB_PATH` env vars -- the former belongs to the deferred admin API, the latter is meaningless once storage is Postgres.
   - The automatic 90-day post-course-end retention purge job (spec section 7) -- it depends on `courses.json`'s `course_end_date`/`retention_days_after_end`, which is deferred along with the rest of that config file above.
   - The `CSP frame-ancestors` header for Canvas iframe embedding (spec section 9) -- only needed if Canvas embeds the instrument directly; the default delivery this plan builds is a link that opens in a new tab, which the spec itself lists as the default.
   - Section 11's Canvas/ICDF-engine changes (the launch-panel rendering, item preview, ERAU tool notice) -- those live in the separate ICDF repository, not `sim`, and are not touched by this plan at all.
5. **This plan produces code in a feature branch/worktree only.** It does not deploy to `sim-prod`. Deploying is a separate, explicit step (build image, `az acr build`, `az containerapp update`) following the same pattern -- and the same explicit user authorization -- already established for this app.

One complete fixture instrument (`AL.json`, Module 4 / Active Listening) is written in this plan to exercise the full pipeline end to end. Its 20 Likert items are realistic but **not** the real, vetted OBLD 500 content -- that only exists in the as-yet-unmigrated Google Forms. Do not ship `AL.json` to students as-is; it is a development/test fixture pending the real migration step.

---

## File Structure

```
server/
  checkin/
    instrumentValidator.js   Pure validation function for instrument JSON (spec section 3 rules)
    instrumentLoader.js      Loads + validates instrument JSON files from disk, serves public/private views
    identity.js               HMAC participant_id derivation, AES-256-GCM email encrypt/decrypt
    completionCode.js         Completion code generation + verification (base32, vowel-stripped)
    scoring.js                Reverse scoring, subscale means, straightlining detection
    db.js                     Postgres schema + queries for checkin_* tables (wraps ../db's pool)
    routes.js                 Express router: GET /api/instrument/..., POST /api/responses
    instruments/
      AL.json                 Fixture instrument: OBLD500 Module 4, Active Listening
  index.js                    MODIFY: mount checkin router, init checkin schema + instruments at boot
  tests/
    checkin.instrumentValidator.test.js
    checkin.instrumentLoader.test.js
    checkin.identity.test.js
    checkin.completionCode.test.js
    checkin.scoring.test.js
    checkin.db.test.js
    checkin.routes.test.js
    setup.js                  MODIFY: add CHECKIN_HMAC_SECRET / CHECKIN_AES_KEY test env vars
client/
  src/
    App.jsx                   MODIFY: export the `C` palette, add `view === "checkin"`, parse ?week/mode
    CheckIn.jsx                New: the whole learner-facing check-in flow (one file, matches App.jsx's
                                single-large-component convention -- this codebase has no other
                                multi-file component split to follow)
.env.example                  MODIFY: document CHECKIN_HMAC_SECRET, CHECKIN_AES_KEY, CHECKIN_INSTRUMENT_DIR
README.md, CLAUDE.md          MODIFY: document the new endpoints and env vars
```

---

### Task 1: Project scaffolding and test environment

**Files:**
- Modify: `server/tests/setup.js`
- Create: `server/checkin/instruments/` (directory, populated in Task 3)

- [ ] **Step 1: Add check-in secrets to the test environment**

Open `server/tests/setup.js` and add these two lines after the existing `process.env.NODE_ENV = 'test';` line:

```javascript
// Check-in module test secrets (not real secrets -- fixed so tests are deterministic)
process.env.CHECKIN_HMAC_SECRET = 'test-hmac-secret-not-real';
process.env.CHECKIN_AES_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='; // base64 of 32 bytes
```

The AES key above is the base64 encoding of the 32-byte ASCII string `0123456789abcdef0123456789abcdef` -- fixed and non-secret, used only in tests.

- [ ] **Step 2: Verify the existing suite still passes**

Run: `cd server && npm test`
Expected: `Test Suites: 3 passed, 3 total` / `Tests: 32 passed, 32 total` (same as before -- this step only adds unused env vars so far).

- [ ] **Step 3: Create the instruments directory**

Run: `mkdir -p server/checkin/instruments`

- [ ] **Step 4: Commit**

```bash
git add server/tests/setup.js
git commit -m "test: add check-in module secrets to test environment"
```

---

### Task 2: Instrument validator

**Files:**
- Create: `server/checkin/instrumentValidator.js`
- Test: `server/tests/checkin.instrumentValidator.test.js`

- [ ] **Step 1: Write the failing tests**

Create `server/tests/checkin.instrumentValidator.test.js`:

```javascript
const { validateInstrument } = require('../checkin/instrumentValidator');

function validInstrument(overrides = {}) {
  const base = {
    course: 'OBLD500',
    module: 4,
    abbrev: 'AL',
    topic: 'Active Listening',
    version: 'dev-fixture-v1',
    scale: {
      points: 7,
      labels: [
        'Strongly Disagree', 'Disagree', 'Somewhat Disagree',
        'Neither Agree nor Disagree', 'Somewhat Agree', 'Agree', 'Strongly Agree',
      ],
    },
    intro: { baseline: 'Baseline intro text.', debrief: 'Debrief intro text.' },
    subscales: [
      {
        id: 'sensing', name: 'Sensing', help: 'Help text.',
        items: [
          { id: 'AL01', text: 'Item 1', reverse: false },
          { id: 'AL02', text: 'Item 2', reverse: false },
          { id: 'AL03', text: 'Item 3', reverse: false },
          { id: 'AL04', text: 'Item 4', reverse: false },
          { id: 'AL05', text: 'Item 5', reverse: true },
        ],
      },
      {
        id: 'attending', name: 'Attending', help: 'Help text.',
        items: [
          { id: 'AL06', text: 'Item 6', reverse: false },
          { id: 'AL07', text: 'Item 7', reverse: false },
          { id: 'AL08', text: 'Item 8', reverse: true },
          { id: 'AL09', text: 'Item 9', reverse: false },
          { id: 'AL10', text: 'Item 10', reverse: false },
        ],
      },
      {
        id: 'processing', name: 'Processing', help: 'Help text.',
        items: [
          { id: 'AL11', text: 'Item 11', reverse: false },
          { id: 'AL12', text: 'Item 12', reverse: false },
          { id: 'AL13', text: 'Item 13', reverse: false },
          { id: 'AL14', text: 'Item 14', reverse: false },
          { id: 'AL15', text: 'Item 15', reverse: false },
        ],
      },
      {
        id: 'responding', name: 'Responding', help: 'Help text.',
        items: [
          { id: 'AL16', text: 'Item 16', reverse: false },
          { id: 'AL17', text: 'Item 17', reverse: false },
          { id: 'AL18', text: 'Item 18', reverse: false },
          { id: 'AL19', text: 'Item 19', reverse: false },
          { id: 'AL20', text: 'Item 20', reverse: false },
        ],
      },
    ],
    debrief_extras: {
      post_experience: {
        name: 'Post-Experience Reflection',
        items: [
          { id: 'AL_PX1', text: 'PX 1', reverse: false },
          { id: 'AL_PX2', text: 'PX 2', reverse: false },
          { id: 'AL_PX3', text: 'PX 3', reverse: false },
          { id: 'AL_PX4', text: 'PX 4', reverse: false },
          { id: 'AL_PX5', text: 'PX 5', reverse: false },
        ],
      },
      open_ended: [
        { id: 'AL_Q1', prompt: 'Prompt 1' },
        { id: 'AL_Q2', prompt: 'Prompt 2' },
        { id: 'AL_Q3', prompt: 'Prompt 3' },
      ],
    },
    completion: { baseline: 'Baseline done.', debrief: 'Debrief done.' },
  };
  return { ...base, ...overrides };
}

describe('validateInstrument', () => {
  test('accepts a fully valid instrument', () => {
    const { valid, errors } = validateInstrument(validInstrument());
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  test('rejects an instrument with 19 items', () => {
    const data = validInstrument();
    data.subscales[3].items.pop(); // now 19 items
    const { valid, errors } = validateInstrument(data);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('exactly 20 items'))).toBe(true);
  });

  test('rejects an instrument with fewer than 2 reverse-scored items', () => {
    const data = validInstrument();
    data.subscales[0].items[4].reverse = false; // was the only other reverse item besides AL08
    data.subscales[1].items[2].reverse = false;
    const { valid, errors } = validateInstrument(data);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('at least 2 reverse-scored items'))).toBe(true);
  });

  test('rejects duplicate item ids', () => {
    const data = validInstrument();
    data.subscales[1].items[0].id = 'AL01'; // duplicates subscale 0's first item
    const { valid, errors } = validateInstrument(data);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('unique'))).toBe(true);
  });

  test('rejects a scale that is not 7 points', () => {
    const data = validInstrument();
    data.scale.points = 5;
    data.scale.labels = data.scale.labels.slice(0, 5);
    const { valid, errors } = validateInstrument(data);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('scale.points'))).toBe(true);
  });

  test('rejects a debrief_extras.post_experience block that is not 5 items', () => {
    const data = validInstrument();
    data.debrief_extras.post_experience.items.pop();
    const { valid, errors } = validateInstrument(data);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('post_experience'))).toBe(true);
  });

  test('rejects an open_ended block that is not 3 prompts', () => {
    const data = validInstrument();
    data.debrief_extras.open_ended.push({ id: 'AL_Q4', prompt: 'Extra' });
    const { valid, errors } = validateInstrument(data);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('open_ended'))).toBe(true);
  });

  test('rejects an em dash anywhere in the text', () => {
    const data = validInstrument();
    data.subscales[0].items[0].text = 'This has an em dash — right there.';
    const { valid, errors } = validateInstrument(data);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('em dash'))).toBe(true);
  });

  test('rejects a double hyphen anywhere in the text', () => {
    const data = validInstrument();
    data.topic = 'Active Listening -- Module 4';
    const { valid, errors } = validateInstrument(data);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('double hyphen'))).toBe(true);
  });

  test('rejects "Bodyswaps" and "grant" case-insensitively', () => {
    const data = validInstrument();
    data.intro.baseline = 'Funded by the BODYSWAPS Immersive Learning Grant.';
    const { valid, errors } = validateInstrument(data);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('Bodyswaps'))).toBe(true);
    expect(errors.some((e) => e.includes('grant'))).toBe(true);
  });

  test('accumulates multiple errors in one pass rather than failing fast', () => {
    const data = validInstrument();
    data.subscales[3].items.pop(); // 19 items
    data.scale.points = 5; // bad scale
    const { errors } = validateInstrument(data);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx jest tests/checkin.instrumentValidator.test.js`
Expected: FAIL with `Cannot find module '../checkin/instrumentValidator'`

- [ ] **Step 3: Write the implementation**

Create `server/checkin/instrumentValidator.js`:

```javascript
const FORBIDDEN_PATTERNS = [
  { name: 'em dash', regex: /—/ },
  { name: 'double hyphen', regex: /--/ },
  { name: '"Bodyswaps"', regex: /bodyswaps/i },
  { name: '"grant"', regex: /grant/i },
];

function collectTextFields(data) {
  const fields = [];
  const push = (label, value) => {
    if (typeof value === 'string') fields.push({ label, value });
  };

  push('topic', data.topic);
  if (data.intro) {
    push('intro.baseline', data.intro.baseline);
    push('intro.debrief', data.intro.debrief);
  }
  if (data.completion) {
    push('completion.baseline', data.completion.baseline);
    push('completion.debrief', data.completion.debrief);
  }

  (data.subscales || []).forEach((s) => {
    push(`subscale ${s.id}.name`, s.name);
    push(`subscale ${s.id}.help`, s.help);
    (s.items || []).forEach((item) => push(`item ${item.id}.text`, item.text));
  });

  const px = data.debrief_extras && data.debrief_extras.post_experience;
  if (px) {
    push('post_experience.name', px.name);
    (px.items || []).forEach((item) => push(`post_experience item ${item.id}.text`, item.text));
  }
  const openEnded = (data.debrief_extras && data.debrief_extras.open_ended) || [];
  openEnded.forEach((q) => push(`open_ended ${q.id}.prompt`, q.prompt));

  return fields;
}

function validateInstrument(data) {
  const errors = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Instrument must be a JSON object'] };
  }

  if (!data.course || typeof data.course !== 'string') errors.push('course is required and must be a string');
  if (!Number.isInteger(data.module)) errors.push('module is required and must be an integer');
  if (!data.abbrev || typeof data.abbrev !== 'string') errors.push('abbrev is required and must be a string');
  if (!data.topic || typeof data.topic !== 'string') errors.push('topic is required and must be a string');
  if (!data.version || typeof data.version !== 'string') errors.push('version is required and must be a string');

  if (!data.scale || data.scale.points !== 7) {
    errors.push('scale.points must equal 7');
  }
  if (!data.scale || !Array.isArray(data.scale.labels) || data.scale.labels.length !== 7) {
    errors.push('scale.labels must be an array of exactly 7 labels');
  }

  if (!data.intro || typeof data.intro.baseline !== 'string' || typeof data.intro.debrief !== 'string') {
    errors.push('intro.baseline and intro.debrief are both required strings');
  }
  if (!data.completion || typeof data.completion.baseline !== 'string' || typeof data.completion.debrief !== 'string') {
    errors.push('completion.baseline and completion.debrief are both required strings');
  }

  const subscales = Array.isArray(data.subscales) ? data.subscales : [];
  if (subscales.length === 0) errors.push('subscales must be a non-empty array');

  const allItems = [];
  subscales.forEach((s, i) => {
    if (!s.id || typeof s.id !== 'string') errors.push(`subscales[${i}].id is required`);
    if (!s.name || typeof s.name !== 'string') errors.push(`subscales[${i}].name is required`);
    if (!Array.isArray(s.items)) {
      errors.push(`subscales[${i}].items must be an array`);
    } else {
      s.items.forEach((item, j) => {
        if (!item.id || typeof item.id !== 'string') errors.push(`subscales[${i}].items[${j}].id is required`);
        if (!item.text || typeof item.text !== 'string') errors.push(`subscales[${i}].items[${j}].text is required`);
        if (typeof item.reverse !== 'boolean') errors.push(`subscales[${i}].items[${j}].reverse must be a boolean`);
        allItems.push(item);
      });
    }
  });

  if (allItems.length !== 20) {
    errors.push(`instrument must have exactly 20 items across all subscales, found ${allItems.length}`);
  }

  const ids = allItems.map((item) => item.id).filter(Boolean);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    errors.push('item ids must be unique across the instrument');
  }

  const reverseCount = allItems.filter((item) => item.reverse === true).length;
  if (reverseCount < 2) {
    errors.push(`instrument must have at least 2 reverse-scored items, found ${reverseCount}`);
  }

  const px = data.debrief_extras && data.debrief_extras.post_experience;
  if (!px || !Array.isArray(px.items) || px.items.length !== 5) {
    errors.push('debrief_extras.post_experience.items must be an array of exactly 5 items');
  } else {
    px.items.forEach((item, j) => {
      if (!item.id || typeof item.id !== 'string') errors.push(`debrief_extras.post_experience.items[${j}].id is required`);
      if (!item.text || typeof item.text !== 'string') errors.push(`debrief_extras.post_experience.items[${j}].text is required`);
    });
  }

  const openEnded = data.debrief_extras && data.debrief_extras.open_ended;
  if (!Array.isArray(openEnded) || openEnded.length !== 3) {
    errors.push('debrief_extras.open_ended must be an array of exactly 3 prompts');
  } else {
    openEnded.forEach((q, j) => {
      if (!q.id || typeof q.id !== 'string') errors.push(`debrief_extras.open_ended[${j}].id is required`);
      if (!q.prompt || typeof q.prompt !== 'string') errors.push(`debrief_extras.open_ended[${j}].prompt is required`);
    });
  }

  collectTextFields(data).forEach(({ label, value }) => {
    FORBIDDEN_PATTERNS.forEach(({ name, regex }) => {
      if (regex.test(value)) {
        errors.push(`${label} contains forbidden ${name}`);
      }
    });
  });

  return { valid: errors.length === 0, errors };
}

module.exports = { validateInstrument };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx jest tests/checkin.instrumentValidator.test.js`
Expected: `Tests: 11 passed, 11 total`

- [ ] **Step 5: Commit**

```bash
git add server/checkin/instrumentValidator.js server/tests/checkin.instrumentValidator.test.js
git commit -m "feat: add check-in instrument validator"
```

---

### Task 3: Fixture instrument (Module 4, Active Listening)

**Files:**
- Create: `server/checkin/instruments/AL.json`

- [ ] **Step 1: Write the fixture instrument**

Create `server/checkin/instruments/AL.json`. This is development/test content -- realistic, but not the real vetted OBLD 500 instrument (that arrives via the separate migration step). It reuses the two example Sensing items and the five Post-Experience items and three open-ended prompts verbatim from the source spec, since those are real spec content, and adds 18 more items across three more subscales to reach 20 with 4 reverse-scored items.

```json
{
  "course": "OBLD500",
  "module": 4,
  "abbrev": "AL",
  "topic": "Active Listening",
  "version": "dev-fixture-v1",
  "scale": {
    "points": 7,
    "labels": ["Strongly Disagree", "Disagree", "Somewhat Disagree",
               "Neither Agree nor Disagree", "Somewhat Agree", "Agree", "Strongly Agree"]
  },
  "intro": {
    "baseline": "This questionnaire measures your current active listening skills across four dimensions. Respond based on how you currently behave in your professional interactions, not how you think you should behave. There are no right or wrong answers.",
    "debrief": "You completed this questionnaire at the start of the module. Answer again based on how you behave now. Then reflect on the module."
  },
  "subscales": [
    {
      "id": "sensing",
      "name": "Sensing",
      "help": "Picking up verbal and nonverbal cues, including emotions and what is left unsaid.",
      "items": [
        {"id": "AL01", "text": "I am sensitive to what others are not saying during conversations.", "reverse": false},
        {"id": "AL02", "text": "I am aware of what team members imply but do not explicitly state.", "reverse": false},
        {"id": "AL03", "text": "I notice shifts in tone of voice that signal how someone really feels.", "reverse": false},
        {"id": "AL04", "text": "I pick up on body language that contradicts what a person is saying.", "reverse": false},
        {"id": "AL05", "text": "I often miss emotional cues that other people notice right away.", "reverse": true}
      ]
    },
    {
      "id": "attending",
      "name": "Attending",
      "help": "Giving the speaker full, undivided focus without distraction.",
      "items": [
        {"id": "AL06", "text": "I give my full attention to the person speaking, even when I am busy.", "reverse": false},
        {"id": "AL07", "text": "I maintain appropriate eye contact and open body language while listening.", "reverse": false},
        {"id": "AL08", "text": "My mind often wanders to other tasks while someone is talking to me.", "reverse": true},
        {"id": "AL09", "text": "I put away distractions such as my phone or laptop during important conversations.", "reverse": false},
        {"id": "AL10", "text": "I stay present in a conversation even when I disagree with what is being said.", "reverse": false}
      ]
    },
    {
      "id": "processing",
      "name": "Processing",
      "help": "Making sense of what is said by organizing and interpreting the message accurately.",
      "items": [
        {"id": "AL11", "text": "I accurately restate what someone has said in my own words.", "reverse": false},
        {"id": "AL12", "text": "I connect what a person is telling me now to things they have said before.", "reverse": false},
        {"id": "AL13", "text": "I check my understanding by summarizing before responding.", "reverse": false},
        {"id": "AL14", "text": "I sometimes assume I understand a person's point before they finish explaining it.", "reverse": true},
        {"id": "AL15", "text": "I distinguish between the facts someone shares and my own interpretation of them.", "reverse": false}
      ]
    },
    {
      "id": "responding",
      "name": "Responding",
      "help": "Responding in ways that show understanding and invite the speaker to continue.",
      "items": [
        {"id": "AL16", "text": "I ask open-ended questions that encourage the other person to share more.", "reverse": false},
        {"id": "AL17", "text": "I hold back my own opinion until I fully understand the other person's point of view.", "reverse": false},
        {"id": "AL18", "text": "I tend to interrupt before the other person has finished their thought.", "reverse": true},
        {"id": "AL19", "text": "I acknowledge a person's feelings before offering a solution.", "reverse": false},
        {"id": "AL20", "text": "My responses show the speaker that I understood what mattered most to them.", "reverse": false}
      ]
    }
  ],
  "debrief_extras": {
    "post_experience": {
      "name": "Post-Experience Reflection",
      "items": [
        {"id": "AL_PX1", "text": "This module improved my understanding of active listening.", "reverse": false},
        {"id": "AL_PX2", "text": "The observation scenario helped me see listening from the speaker's perspective.", "reverse": false},
        {"id": "AL_PX3", "text": "The simulation gave me realistic practice with active listening skills.", "reverse": false},
        {"id": "AL_PX4", "text": "I feel more confident applying active listening in my leadership practice.", "reverse": false},
        {"id": "AL_PX5", "text": "I would recommend this kind of practice to other leadership students.", "reverse": false}
      ]
    },
    "open_ended": [
      {"id": "AL_Q1", "prompt": "Describe the most important insight about active listening you gained from this module."},
      {"id": "AL_Q2", "prompt": "Which moment in the observation or simulation had the greatest impact on you, and why?"},
      {"id": "AL_Q3", "prompt": "How will you apply what you learned in your leadership practice going forward?"}
    ]
  },
  "completion": {
    "baseline": "Thank you. Copy your completion code into the Canvas item {module}.3 Baseline Check Completion, then continue to Ground School.",
    "debrief": "Thank you. Copy your completion code into the Canvas item {module}.10 Debrief Completion."
  }
}
```

- [ ] **Step 2: Write a test that loads and validates this exact file**

Create `server/tests/checkin.instrumentLoader.test.js` (this file grows in Task 4; start it here):

```javascript
const path = require('path');
const { validateInstrument } = require('../checkin/instrumentValidator');

describe('AL.json fixture', () => {
  test('the Module 4 fixture instrument passes the validator', () => {
    const data = require('../checkin/instruments/AL.json');
    const { valid, errors } = validateInstrument(data);
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `cd server && npx jest tests/checkin.instrumentLoader.test.js`
Expected: `Tests: 1 passed, 1 total`

- [ ] **Step 4: Commit**

```bash
git add server/checkin/instruments/AL.json server/tests/checkin.instrumentLoader.test.js
git commit -m "feat: add Module 4 Active Listening fixture instrument"
```

---

### Task 4: Instrument loader

**Files:**
- Create: `server/checkin/instrumentLoader.js`
- Modify: `server/tests/checkin.instrumentLoader.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/checkin.instrumentLoader.test.js` (below the existing fixture test, same file):

```javascript
const fs = require('fs');
const os = require('os');

describe('instrumentLoader', () => {
  let loader;
  let tmpDir;

  beforeEach(() => {
    jest.resetModules();
    loader = require('../checkin/instrumentLoader');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-instruments-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('loads a valid instrument and serves it via getInstrument', () => {
    loader.load(path.join(__dirname, '..', 'checkin', 'instruments'));
    const instrument = loader.getInstrument('OBLD500', 4);
    expect(instrument).not.toBeNull();
    expect(instrument.abbrev).toBe('AL');
    expect(instrument.subscales.flatMap((s) => s.items)).toHaveLength(20);
  });

  test('getInstrument returns null for an unknown course/module', () => {
    loader.load(path.join(__dirname, '..', 'checkin', 'instruments'));
    expect(loader.getInstrument('OBLD500', 99)).toBeNull();
  });

  test('throws with all validation errors when a file is invalid', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'BAD.json'),
      JSON.stringify({ course: 'OBLD500', module: 1, abbrev: 'BAD', topic: 'Bad', version: '1' })
    );
    expect(() => loader.load(tmpDir)).toThrow(/BAD\.json/);
  });

  test('getPublicView strips reverse flags for baseline', () => {
    loader.load(path.join(__dirname, '..', 'checkin', 'instruments'));
    const view = loader.getPublicView('OBLD500', 4, 'baseline');
    expect(view.subscales[0].items[0]).toEqual({ id: 'AL01', text: expect.any(String) });
    expect(view.debrief_extras).toBeUndefined();
  });

  test('getPublicView includes debrief_extras only for debrief', () => {
    loader.load(path.join(__dirname, '..', 'checkin', 'instruments'));
    const view = loader.getPublicView('OBLD500', 4, 'debrief');
    expect(view.debrief_extras.post_experience.items).toHaveLength(5);
    expect(view.debrief_extras.open_ended).toHaveLength(3);
  });

  test('getPublicView returns null for an unknown instrument', () => {
    loader.load(path.join(__dirname, '..', 'checkin', 'instruments'));
    expect(loader.getPublicView('OBLD500', 99, 'baseline')).toBeNull();
  });

  test('reload re-reads the directory', () => {
    loader.load(path.join(__dirname, '..', 'checkin', 'instruments'));
    expect(loader.getInstrument('OBLD500', 4)).not.toBeNull();
    loader.reload(tmpDir); // empty dir
    expect(loader.getInstrument('OBLD500', 4)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx jest tests/checkin.instrumentLoader.test.js`
Expected: FAIL with `Cannot find module '../checkin/instrumentLoader'`

- [ ] **Step 3: Write the implementation**

Create `server/checkin/instrumentLoader.js`:

```javascript
const fs = require('fs');
const path = require('path');
const { validateInstrument } = require('./instrumentValidator');

const DEFAULT_DIR = path.join(__dirname, 'instruments');

let store = null; // Map "course/module" -> instrument object
let loadedDir = null;

function load(dir) {
  const targetDir = dir || process.env.CHECKIN_INSTRUMENT_DIR || DEFAULT_DIR;
  const files = fs.readdirSync(targetDir).filter((f) => f.endsWith('.json'));
  const nextStore = new Map();
  const allErrors = [];

  for (const file of files) {
    const fullPath = path.join(targetDir, file);
    const raw = fs.readFileSync(fullPath, 'utf8');
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      allErrors.push(`${file}: invalid JSON (${err.message})`);
      continue;
    }
    const { valid, errors } = validateInstrument(data);
    if (!valid) {
      errors.forEach((e) => allErrors.push(`${file}: ${e}`));
      continue;
    }
    nextStore.set(`${data.course}/${data.module}`, data);
  }

  if (allErrors.length > 0) {
    throw new Error(`Instrument validation failed:\n${allErrors.join('\n')}`);
  }

  store = nextStore;
  loadedDir = targetDir;
  return store;
}

function ensureLoaded() {
  if (!store) load();
  return store;
}

function getInstrument(course, moduleNum) {
  ensureLoaded();
  return store.get(`${course}/${moduleNum}`) || null;
}

function getPublicView(course, moduleNum, phase) {
  const instrument = getInstrument(course, moduleNum);
  if (!instrument) return null;

  const view = {
    course: instrument.course,
    module: instrument.module,
    abbrev: instrument.abbrev,
    topic: instrument.topic,
    version: instrument.version,
    scale: instrument.scale,
    intro: instrument.intro[phase],
    subscales: instrument.subscales.map((s) => ({
      id: s.id,
      name: s.name,
      help: s.help,
      items: s.items.map((item) => ({ id: item.id, text: item.text })),
    })),
    completion: instrument.completion[phase],
  };

  if (phase === 'debrief') {
    view.debrief_extras = {
      post_experience: {
        name: instrument.debrief_extras.post_experience.name,
        items: instrument.debrief_extras.post_experience.items.map((item) => ({
          id: item.id,
          text: item.text,
        })),
      },
      open_ended: instrument.debrief_extras.open_ended.map((q) => ({ id: q.id, prompt: q.prompt })),
    };
  }

  return view;
}

function reload(dir) {
  store = null;
  return load(dir || loadedDir);
}

module.exports = { load, ensureLoaded, getInstrument, getPublicView, reload };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx jest tests/checkin.instrumentLoader.test.js`
Expected: `Tests: 8 passed, 8 total`

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `cd server && npm test`
Expected: all suites pass (existing 32 + new instrument validator/loader tests)

- [ ] **Step 6: Commit**

```bash
git add server/checkin/instrumentLoader.js server/tests/checkin.instrumentLoader.test.js
git commit -m "feat: add check-in instrument loader with public/private views"
```

---

### Task 5: Identity (participant ID + email encryption)

**Files:**
- Create: `server/checkin/identity.js`
- Test: `server/tests/checkin.identity.test.js`

- [ ] **Step 1: Write the failing tests**

Create `server/tests/checkin.identity.test.js`:

```javascript
const { deriveParticipantId, encryptEmail, decryptEmail } = require('../checkin/identity');

const SECRET = process.env.CHECKIN_HMAC_SECRET;
const KEY = process.env.CHECKIN_AES_KEY;

describe('deriveParticipantId', () => {
  test('is deterministic for the same email and secret', () => {
    const a = deriveParticipantId('Student@erau.edu', SECRET);
    const b = deriveParticipantId('Student@erau.edu', SECRET);
    expect(a).toBe(b);
  });

  test('is case-insensitive and trims whitespace', () => {
    const a = deriveParticipantId('Student@erau.edu', SECRET);
    const b = deriveParticipantId('  student@ERAU.edu  ', SECRET);
    expect(a).toBe(b);
  });

  test('differs for different emails', () => {
    const a = deriveParticipantId('student1@erau.edu', SECRET);
    const b = deriveParticipantId('student2@erau.edu', SECRET);
    expect(a).not.toBe(b);
  });

  test('differs for different secrets', () => {
    const a = deriveParticipantId('student@erau.edu', 'secret-a');
    const b = deriveParticipantId('student@erau.edu', 'secret-b');
    expect(a).not.toBe(b);
  });

  test('returns a 64-character hex string (SHA-256)', () => {
    const id = deriveParticipantId('student@erau.edu', SECRET);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('encryptEmail / decryptEmail', () => {
  test('round-trips the original email', () => {
    const encrypted = encryptEmail('student@erau.edu', KEY);
    expect(decryptEmail(encrypted, KEY)).toBe('student@erau.edu');
  });

  test('produces a different ciphertext each time (random IV)', () => {
    const a = encryptEmail('student@erau.edu', KEY);
    const b = encryptEmail('student@erau.edu', KEY);
    expect(a).not.toBe(b);
  });

  test('does not store the plaintext email anywhere in the ciphertext string', () => {
    const encrypted = encryptEmail('student@erau.edu', KEY);
    expect(encrypted).not.toContain('student');
    expect(encrypted).not.toContain('erau');
  });

  test('throws when the key does not decode to 32 bytes', () => {
    expect(() => encryptEmail('student@erau.edu', 'dG9vc2hvcnQ=')).toThrow(/32 bytes/);
  });

  test('fails to decrypt with the wrong key', () => {
    const encrypted = encryptEmail('student@erau.edu', KEY);
    const wrongKey = Buffer.alloc(32, 7).toString('base64');
    expect(() => decryptEmail(encrypted, wrongKey)).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx jest tests/checkin.identity.test.js`
Expected: FAIL with `Cannot find module '../checkin/identity'`

- [ ] **Step 3: Write the implementation**

Create `server/checkin/identity.js`:

```javascript
const crypto = require('crypto');

function deriveParticipantId(email, secret) {
  const normalized = email.trim().toLowerCase();
  return crypto.createHmac('sha256', secret).update(normalized).digest('hex');
}

function encryptEmail(email, keyBase64) {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) {
    throw new Error('CHECKIN_AES_KEY must decode to exactly 32 bytes (AES-256)');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(email, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

function decryptEmail(encrypted, keyBase64) {
  const key = Buffer.from(keyBase64, 'base64');
  const [ivB64, tagB64, ciphertextB64] = encrypted.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

module.exports = { deriveParticipantId, encryptEmail, decryptEmail };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx jest tests/checkin.identity.test.js`
Expected: `Tests: 10 passed, 10 total`

- [ ] **Step 5: Commit**

```bash
git add server/checkin/identity.js server/tests/checkin.identity.test.js
git commit -m "feat: add check-in identity module (HMAC participant id, AES-256-GCM email storage)"
```

---

### Task 6: Completion codes

**Files:**
- Create: `server/checkin/completionCode.js`
- Test: `server/tests/checkin.completionCode.test.js`

- [ ] **Step 1: Write the failing tests**

Create `server/tests/checkin.completionCode.test.js`:

```javascript
const { generateCompletionCode, verifyCompletionCode } = require('../checkin/completionCode');

const SECRET = process.env.CHECKIN_HMAC_SECRET;

const baseArgs = {
  abbrev: 'AL',
  module: 4,
  phase: 'baseline',
  course: 'OBLD500',
  participantId: 'abc123',
  submittedAt: '2027-01-15T12:00:00.000Z',
  secret: SECRET,
};

describe('generateCompletionCode', () => {
  test('matches the spec format {ABBREV}{N}-{PHASE}-{8 chars}', () => {
    const code = generateCompletionCode(baseArgs);
    expect(code).toMatch(/^AL4-B-[A-Z2-7]{8}$/);
  });

  test('uses D for the debrief phase', () => {
    const code = generateCompletionCode({ ...baseArgs, phase: 'debrief' });
    expect(code).toMatch(/^AL4-D-[A-Z2-7]{8}$/);
  });

  test('contains no vowels in the 8-character suffix', () => {
    const code = generateCompletionCode(baseArgs);
    const suffix = code.split('-')[2];
    expect(suffix).not.toMatch(/[AEIOU]/);
  });

  test('is deterministic for the same inputs', () => {
    const a = generateCompletionCode(baseArgs);
    const b = generateCompletionCode(baseArgs);
    expect(a).toBe(b);
  });

  test('differs when participantId differs', () => {
    const a = generateCompletionCode(baseArgs);
    const b = generateCompletionCode({ ...baseArgs, participantId: 'xyz789' });
    expect(a).not.toBe(b);
  });

  test('differs when submittedAt differs', () => {
    const a = generateCompletionCode(baseArgs);
    const b = generateCompletionCode({ ...baseArgs, submittedAt: '2027-01-15T12:00:01.000Z' });
    expect(a).not.toBe(b);
  });
});

describe('verifyCompletionCode', () => {
  test('verifies a code generated with the same inputs', () => {
    const code = generateCompletionCode(baseArgs);
    expect(verifyCompletionCode(code, baseArgs)).toBe(true);
  });

  test('rejects a code with one character changed', () => {
    const code = generateCompletionCode(baseArgs);
    const tampered = code.slice(0, -1) + (code.slice(-1) === 'Z' ? 'Y' : 'Z');
    expect(verifyCompletionCode(tampered, baseArgs)).toBe(false);
  });

  test('rejects a code verified against different arguments', () => {
    const code = generateCompletionCode(baseArgs);
    expect(verifyCompletionCode(code, { ...baseArgs, module: 5 })).toBe(false);
  });

  test('rejects a code of the wrong length without throwing', () => {
    expect(verifyCompletionCode('short', baseArgs)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx jest tests/checkin.completionCode.test.js`
Expected: FAIL with `Cannot find module '../checkin/completionCode'`

- [ ] **Step 3: Write the implementation**

Create `server/checkin/completionCode.js`:

```javascript
const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function stripVowels(str) {
  return str.replace(/[AEIOU]/g, '');
}

function generateCompletionCode({ abbrev, module, phase, course, participantId, submittedAt, secret }) {
  const phaseLetter = phase === 'baseline' ? 'B' : 'D';
  const message = `${course}|${module}|${phase}|${participantId}|${submittedAt}`;
  const digest = crypto.createHmac('sha256', secret).update(message).digest();
  const encoded = stripVowels(base32Encode(digest));
  const suffix = encoded.slice(0, 8);
  return `${abbrev}${module}-${phaseLetter}-${suffix}`;
}

function verifyCompletionCode(code, args) {
  const expected = generateCompletionCode(args);
  if (typeof code !== 'string' || expected.length !== code.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(code));
}

module.exports = { generateCompletionCode, verifyCompletionCode, base32Encode };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx jest tests/checkin.completionCode.test.js`
Expected: `Tests: 10 passed, 10 total`

Note: the vowel-stripped base32 alphabet leaves 21 possible characters per position (26 letters + 6 digits, minus 5 vowels = 27, minus digits already excluded from vowel set so actually 21 letters + 6 digits = 27 symbols). A SHA-256 digest is long enough (52 base32 characters before stripping) that stripping ~5/26 of them still comfortably leaves 8+ characters; if this ever throws or produces a short suffix in production, that is a sign the HMAC implementation changed and needs re-checking -- add an assertion in `generateCompletionCode` in a future pass if this ever becomes a real concern. Not needed for v0.1: the test suite already proves it produces exactly 8 characters on real SHA-256 output.

- [ ] **Step 5: Commit**

```bash
git add server/checkin/completionCode.js server/tests/checkin.completionCode.test.js
git commit -m "feat: add check-in completion code generation and verification"
```

---

### Task 7: Scoring

**Files:**
- Create: `server/checkin/scoring.js`
- Test: `server/tests/checkin.scoring.test.js`

- [ ] **Step 1: Write the failing tests**

Create `server/tests/checkin.scoring.test.js`:

```javascript
const { scoreItem, scoreAllItems, computeSubscaleScores, isStraightline } = require('../checkin/scoring');

const instrument = require('../checkin/instruments/AL.json');

function allSevens() {
  const answers = {};
  instrument.subscales.forEach((s) => s.items.forEach((item) => { answers[item.id] = 7; }));
  return answers;
}

describe('scoreItem', () => {
  test('returns the raw value for a non-reverse item', () => {
    expect(scoreItem(5, false)).toBe(5);
  });

  test('returns 8 minus the raw value for a reverse item', () => {
    expect(scoreItem(5, true)).toBe(3);
    expect(scoreItem(1, true)).toBe(7);
    expect(scoreItem(7, true)).toBe(1);
  });
});

describe('scoreAllItems', () => {
  test('returns one row per item with raw and scored values', () => {
    const answers = allSevens();
    const rows = scoreAllItems(instrument, answers);
    expect(rows).toHaveLength(20);
    const al01 = rows.find((r) => r.item_id === 'AL01');
    expect(al01).toEqual({ item_id: 'AL01', raw_value: 7, scored_value: 7 }); // not reverse
    const al05 = rows.find((r) => r.item_id === 'AL05');
    expect(al05).toEqual({ item_id: 'AL05', raw_value: 7, scored_value: 1 }); // reverse
  });
});

describe('computeSubscaleScores', () => {
  test('computes the mean scored value per subscale', () => {
    const answers = allSevens();
    const scores = computeSubscaleScores(instrument, answers);
    // sensing subscale: AL01-04 are 7 (not reverse), AL05 is reverse so scores 1
    // mean = (7+7+7+7+1)/5 = 5.8
    const sensing = scores.find((s) => s.subscale_id === 'sensing');
    expect(sensing.mean).toBe(5.8);
    expect(sensing.n_items).toBe(5);
  });

  test('returns one entry per subscale', () => {
    const scores = computeSubscaleScores(instrument, allSevens());
    expect(scores).toHaveLength(4);
  });
});

describe('isStraightline', () => {
  test('is true when every item has the same raw value', () => {
    expect(isStraightline(instrument, allSevens())).toBe(true);
  });

  test('is false when at least one item differs', () => {
    const answers = allSevens();
    answers.AL10 = 3;
    expect(isStraightline(instrument, answers)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx jest tests/checkin.scoring.test.js`
Expected: FAIL with `Cannot find module '../checkin/scoring'`

- [ ] **Step 3: Write the implementation**

Create `server/checkin/scoring.js`:

```javascript
function scoreItem(rawValue, reverse) {
  return reverse ? 8 - rawValue : rawValue;
}

function scoreAllItems(instrument, answers) {
  const allItems = instrument.subscales.flatMap((s) => s.items);
  return allItems.map((item) => ({
    item_id: item.id,
    raw_value: answers[item.id],
    scored_value: scoreItem(answers[item.id], item.reverse),
  }));
}

function computeSubscaleScores(instrument, answers) {
  return instrument.subscales.map((s) => {
    const scored = s.items.map((item) => scoreItem(answers[item.id], item.reverse));
    const mean = scored.reduce((sum, v) => sum + v, 0) / scored.length;
    return { subscale_id: s.id, mean: Math.round(mean * 100) / 100, n_items: scored.length };
  });
}

function isStraightline(instrument, answers) {
  const allItems = instrument.subscales.flatMap((s) => s.items);
  const values = allItems.map((item) => answers[item.id]);
  return values.every((v) => v === values[0]);
}

module.exports = { scoreItem, scoreAllItems, computeSubscaleScores, isStraightline };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx jest tests/checkin.scoring.test.js`
Expected: `Tests: 8 passed, 8 total`

- [ ] **Step 5: Commit**

```bash
git add server/checkin/scoring.js server/tests/checkin.scoring.test.js
git commit -m "feat: add check-in scoring (reverse scoring, subscale means, straightlining)"
```

---

### Task 8: Postgres schema and queries

**Files:**
- Create: `server/checkin/db.js`
- Test: `server/tests/checkin.db.test.js`

This mirrors the existing `server/db.js` / `server/tests/db.test.js` pattern: mock the raw `pg` pool from `../db` and assert on the SQL text and parameters passed to `pool.query`.

- [ ] **Step 1: Write the failing tests**

Create `server/tests/checkin.db.test.js`:

```javascript
const mockQuery = jest.fn();
const mockPool = { query: mockQuery };
let mockAvailable = true;

jest.mock('../db', () => ({
  getPool: () => (mockAvailable ? mockPool : null),
  isAvailable: () => mockAvailable,
}));

const checkinDb = require('../checkin/db');

beforeEach(() => {
  mockAvailable = true;
  mockQuery.mockReset();
});

describe('initCheckinSchema', () => {
  test('creates all five checkin tables when the pool is available', async () => {
    mockQuery.mockResolvedValueOnce({});
    const result = await checkinDb.initCheckinSchema();
    expect(result).toBe(true);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS checkin_instruments');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS checkin_participants');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS checkin_responses');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS checkin_response_items');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS checkin_subscale_scores');
  });

  test('returns false and does not throw when no pool is available', async () => {
    mockAvailable = false;
    const result = await checkinDb.initCheckinSchema();
    expect(result).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('returns false when the query rejects', async () => {
    mockQuery.mockRejectedValueOnce(new Error('syntax error'));
    const result = await checkinDb.initCheckinSchema();
    expect(result).toBe(false);
  });
});

describe('upsertParticipant', () => {
  test('inserts with ON CONFLICT DO NOTHING', async () => {
    mockQuery.mockResolvedValueOnce({});
    await checkinDb.upsertParticipant('pid123', 'enc-blob', 'email');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO checkin_participants'),
      ['pid123', 'enc-blob', 'email']
    );
    expect(mockQuery.mock.calls[0][0]).toContain('ON CONFLICT (participant_id) DO NOTHING');
  });
});

describe('findLatestResponseId', () => {
  test('returns the id of the most recent matching response', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 42 }] });
    const id = await checkinDb.findLatestResponseId('pid123', 'OBLD500', 4, 'baseline');
    expect(id).toBe(42);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM checkin_responses'),
      ['pid123', 'OBLD500', 4, 'baseline']
    );
  });

  test('returns null when there is no prior response', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const id = await checkinDb.findLatestResponseId('pid123', 'OBLD500', 4, 'baseline');
    expect(id).toBeNull();
  });
});

describe('insertResponse', () => {
  test('inserts the response row, then item rows, then subscale rows', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 7, submitted_at: '2027-01-15T00:00:00Z' }] }) // response insert
      .mockResolvedValue({}); // all subsequent inserts

    const result = await checkinDb.insertResponse({
      course: 'OBLD500',
      module: 4,
      phase: 'baseline',
      participantId: 'pid123',
      instrumentVersion: 'dev-fixture-v1',
      startedAt: '2027-01-15T00:00:00Z',
      straightlineFlag: false,
      supersedes: null,
      completionCode: 'AL4-B-K7Q2M9PX',
      itemsJson: { AL01: 5 },
      extrasJson: null,
      scoredItems: [{ item_id: 'AL01', raw_value: 5, scored_value: 5 }],
      subscaleScores: [{ subscale_id: 'sensing', mean: 5, n_items: 5 }],
    });

    expect(result).toEqual({ id: 7, submitted_at: '2027-01-15T00:00:00Z' });
    expect(mockQuery).toHaveBeenCalledTimes(3); // response + 1 item + 1 subscale score
    expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO checkin_responses');
    expect(mockQuery.mock.calls[1][0]).toContain('INSERT INTO checkin_response_items');
    expect(mockQuery.mock.calls[1][1]).toEqual([7, 'AL01', 5, 5]);
    expect(mockQuery.mock.calls[2][0]).toContain('INSERT INTO checkin_subscale_scores');
    expect(mockQuery.mock.calls[2][1]).toEqual([7, 'sensing', 5, 5]);
  });
});

describe('recordInstrumentVersion', () => {
  test('upserts with ON CONFLICT DO UPDATE', async () => {
    mockQuery.mockResolvedValueOnce({});
    await checkinDb.recordInstrumentVersion('OBLD500', 4, 'baseline', 'dev-fixture-v1', { some: 'json' });
    expect(mockQuery.mock.calls[0][0]).toContain('ON CONFLICT (course, module, phase) DO UPDATE');
    expect(mockQuery.mock.calls[0][1][0]).toBe('OBLD500');
    expect(mockQuery.mock.calls[0][1][3]).toBe('dev-fixture-v1');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx jest tests/checkin.db.test.js`
Expected: FAIL with `Cannot find module '../checkin/db'`

- [ ] **Step 3: Write the implementation**

Create `server/checkin/db.js`:

```javascript
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
        participant_id VARCHAR(64) PRIMARY KEY,
        email_encrypted TEXT,
        identity_mode VARCHAR(16) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS checkin_responses (
        id SERIAL PRIMARY KEY,
        course VARCHAR(32) NOT NULL,
        module INTEGER NOT NULL,
        phase VARCHAR(16) NOT NULL CHECK (phase IN ('baseline', 'debrief')),
        participant_id VARCHAR(64) NOT NULL REFERENCES checkin_participants(participant_id),
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
        scored_value INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS checkin_subscale_scores (
        response_id INTEGER NOT NULL REFERENCES checkin_responses(id) ON DELETE CASCADE,
        subscale_id VARCHAR(32) NOT NULL,
        mean NUMERIC(4,2) NOT NULL,
        n_items INTEGER NOT NULL
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
     ORDER BY submitted_at DESC LIMIT 1`,
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

module.exports = {
  isAvailable,
  initCheckinSchema,
  upsertParticipant,
  findLatestResponseId,
  insertResponse,
  recordInstrumentVersion,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx jest tests/checkin.db.test.js`
Expected: `Tests: 9 passed, 9 total`

- [ ] **Step 5: Commit**

```bash
git add server/checkin/db.js server/tests/checkin.db.test.js
git commit -m "feat: add check-in Postgres schema and query helpers"
```

---

### Task 9: API routes

**Files:**
- Create: `server/checkin/routes.js`
- Test: `server/tests/checkin.routes.test.js`

Unlike Task 8, these tests mock `../checkin/db` (not the raw `../db` pool) -- `routes.js` never touches `pg` directly, only the higher-level functions from Task 8.

- [ ] **Step 1: Write the failing tests**

Create `server/tests/checkin.routes.test.js`:

```javascript
const request = require('supertest');

let mockAvailable = true;
const mockUpsertParticipant = jest.fn().mockResolvedValue(undefined);
const mockFindLatestResponseId = jest.fn().mockResolvedValue(null);
const mockInsertResponse = jest.fn().mockResolvedValue({ id: 1, submitted_at: '2027-01-15T00:00:00Z' });

jest.mock('../checkin/db', () => ({
  isAvailable: () => mockAvailable,
  upsertParticipant: (...args) => mockUpsertParticipant(...args),
  findLatestResponseId: (...args) => mockFindLatestResponseId(...args),
  insertResponse: (...args) => mockInsertResponse(...args),
  recordInstrumentVersion: jest.fn().mockResolvedValue(true),
  initCheckinSchema: jest.fn().mockResolvedValue(true),
}));

// Mock the sim_sessions db module too, since index.js requires it unconditionally.
jest.mock('../db', () => ({
  getPool: () => null,
  isAvailable: () => false,
  initSchema: jest.fn().mockResolvedValue(true),
  setPool: jest.fn(),
}));

function createApp() {
  delete require.cache[require.resolve('../index')];
  Object.keys(require.cache).forEach((key) => {
    if (key.includes('express-rate-limit')) delete require.cache[key];
  });
  return require('../index');
}

const validBaselineBody = () => ({
  course: 'OBLD500',
  module: 4,
  phase: 'baseline',
  identity: { email: 'student@erau.edu' },
  started_at: '2027-01-15T00:00:00.000Z',
  answers: {
    AL01: 5, AL02: 5, AL03: 5, AL04: 5, AL05: 5,
    AL06: 5, AL07: 5, AL08: 5, AL09: 5, AL10: 5,
    AL11: 5, AL12: 5, AL13: 5, AL14: 5, AL15: 5,
    AL16: 5, AL17: 5, AL18: 5, AL19: 5, AL20: 5,
  },
});

describe('GET /api/instrument/:course/:module/:phase', () => {
  let app;
  beforeEach(() => { app = createApp(); });

  test('returns the public baseline view without reverse flags', async () => {
    const res = await request(app).get('/api/instrument/OBLD500/4/baseline');
    expect(res.status).toBe(200);
    expect(res.body.abbrev).toBe('AL');
    expect(res.body.subscales[0].items[0]).toEqual({ id: 'AL01', text: expect.any(String) });
    expect(res.body.debrief_extras).toBeUndefined();
  });

  test('returns debrief_extras for the debrief phase', async () => {
    const res = await request(app).get('/api/instrument/OBLD500/4/debrief');
    expect(res.status).toBe(200);
    expect(res.body.debrief_extras.open_ended).toHaveLength(3);
  });

  test('returns 400 for an invalid phase', async () => {
    const res = await request(app).get('/api/instrument/OBLD500/4/nonsense');
    expect(res.status).toBe(400);
  });

  test('returns 404 for an unknown module', async () => {
    const res = await request(app).get('/api/instrument/OBLD500/99/baseline');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/responses', () => {
  let app;

  beforeEach(() => {
    mockAvailable = true;
    app = createApp();
    mockUpsertParticipant.mockClear();
    mockFindLatestResponseId.mockClear().mockResolvedValue(null);
    mockInsertResponse.mockClear().mockResolvedValue({ id: 1, submitted_at: '2027-01-15T00:00:00Z' });
  });

  test('accepts a valid baseline submission and returns a completion code', async () => {
    const res = await request(app).post('/api/responses').send(validBaselineBody());
    expect(res.status).toBe(200);
    expect(res.body.completion_code).toMatch(/^AL4-B-[A-Z2-7]{8}$/);
    expect(res.body.subscale_means).toHaveLength(4);
    expect(mockInsertResponse).toHaveBeenCalledTimes(1);
  });

  test('derives the same participant_id for the same email across calls', async () => {
    await request(app).post('/api/responses').send(validBaselineBody());
    await request(app).post('/api/responses').send(validBaselineBody());
    const firstId = mockUpsertParticipant.mock.calls[0][0];
    const secondId = mockUpsertParticipant.mock.calls[1][0];
    expect(firstId).toBe(secondId);
  });

  test('returns 400 for an invalid email', async () => {
    const body = { ...validBaselineBody(), identity: { email: 'not-an-email' } };
    const res = await request(app).post('/api/responses').send(body);
    expect(res.status).toBe(400);
    expect(mockInsertResponse).not.toHaveBeenCalled();
  });

  test('returns 400 when an item answer is out of range', async () => {
    const body = validBaselineBody();
    body.answers.AL01 = 9;
    const res = await request(app).post('/api/responses').send(body);
    expect(res.status).toBe(400);
  });

  test('returns 400 when an item is missing', async () => {
    const body = validBaselineBody();
    delete body.answers.AL01;
    const res = await request(app).post('/api/responses').send(body);
    expect(res.status).toBe(400);
  });

  test('returns 400 for an unknown item id', async () => {
    const body = validBaselineBody();
    body.answers.NOT_REAL = 5;
    const res = await request(app).post('/api/responses').send(body);
    expect(res.status).toBe(400);
  });

  test('returns 404 for an unknown course/module', async () => {
    const body = { ...validBaselineBody(), module: 99 };
    const res = await request(app).post('/api/responses').send(body);
    expect(res.status).toBe(404);
  });

  test('requires extras for a debrief submission', async () => {
    const body = { ...validBaselineBody(), phase: 'debrief' };
    const res = await request(app).post('/api/responses').send(body);
    expect(res.status).toBe(400);
  });

  test('accepts a complete debrief submission', async () => {
    const body = {
      ...validBaselineBody(),
      phase: 'debrief',
      extras: {
        post_experience: { AL_PX1: 6, AL_PX2: 6, AL_PX3: 6, AL_PX4: 6, AL_PX5: 6 },
        open_ended: {
          AL_Q1: 'A'.repeat(40),
          AL_Q2: 'B'.repeat(40),
          AL_Q3: 'C'.repeat(40),
        },
      },
    };
    const res = await request(app).post('/api/responses').send(body);
    expect(res.status).toBe(200);
  });

  test('rejects an open-ended answer shorter than 40 characters', async () => {
    const body = {
      ...validBaselineBody(),
      phase: 'debrief',
      extras: {
        post_experience: { AL_PX1: 6, AL_PX2: 6, AL_PX3: 6, AL_PX4: 6, AL_PX5: 6 },
        open_ended: { AL_Q1: 'too short', AL_Q2: 'B'.repeat(40), AL_Q3: 'C'.repeat(40) },
      },
    };
    const res = await request(app).post('/api/responses').send(body);
    expect(res.status).toBe(400);
  });

  test('sets supersedes when a prior response exists', async () => {
    mockFindLatestResponseId.mockResolvedValueOnce(17);
    await request(app).post('/api/responses').send(validBaselineBody());
    expect(mockInsertResponse.mock.calls[0][0].supersedes).toBe(17);
  });

  test('returns 503 when the database is not configured', async () => {
    mockAvailable = false;
    app = createApp();
    const res = await request(app).post('/api/responses').send(validBaselineBody());
    expect(res.status).toBe(503);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx jest tests/checkin.routes.test.js`
Expected: FAIL (route not mounted / module not found)

- [ ] **Step 3: Write the implementation**

Create `server/checkin/routes.js`:

```javascript
const express = require('express');
const rateLimit = require('express-rate-limit');
const instrumentLoader = require('./instrumentLoader');
const identity = require('./identity');
const completionCode = require('./completionCode');
const scoring = require('./scoring');
const checkinDb = require('./db');

const router = express.Router();

const checkinLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait before trying again.' },
});

function requireDb(req, res, next) {
  if (!checkinDb.isAvailable()) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  next();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_PHASES = ['baseline', 'debrief'];

// IMPORTANT: checkinLimiter (and, on the POST route, the 64KB json parser)
// are attached as PER-ROUTE middleware arguments below, not via a bare
// router.use(fn). This router is mounted at the shared /api prefix in
// index.js, and router.use(fn) with no path runs for every request that
// enters the router -- including /api/chat, /api/sessions, etc. -- even
// when no route inside this router ends up matching. Per-route middleware
// only fires when that specific route's path matches, which is what keeps
// these two checks scoped to just the two check-in endpoints. (This was
// caught by code review after an earlier draft used router.use(fn) and
// broke body parsing/rate limiting for every other /api/* route in the
// app -- verified by reproduction. Don't reintroduce that pattern here.)

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

router.post('/responses', checkinLimiter, express.json({ limit: '64kb' }), requireDb, async (req, res) => {
  try {
    const { course, phase, identity: ident, started_at, answers, extras } = req.body;
    const moduleNum = Number(req.body.module);

    if (!course || typeof course !== 'string') {
      return res.status(400).json({ error: 'course is required' });
    }
    if (!Number.isInteger(moduleNum)) {
      return res.status(400).json({ error: 'module must be an integer' });
    }
    if (!VALID_PHASES.includes(phase)) {
      return res.status(400).json({ error: 'phase must be "baseline" or "debrief"' });
    }
    if (!ident || typeof ident.email !== 'string' || !EMAIL_RE.test(ident.email)) {
      return res.status(400).json({ error: 'identity.email is required and must be a valid email' });
    }
    if (!started_at || typeof started_at !== 'string') {
      return res.status(400).json({ error: 'started_at is required' });
    }
    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'answers object is required' });
    }

    const instrument = instrumentLoader.getInstrument(course, moduleNum);
    if (!instrument) {
      return res.status(404).json({ error: 'Instrument not found' });
    }

    const allItems = instrument.subscales.flatMap((s) => s.items);
    for (const item of allItems) {
      const v = answers[item.id];
      if (!Number.isInteger(v) || v < 1 || v > instrument.scale.points) {
        return res.status(400).json({
          error: `answers.${item.id} must be an integer between 1 and ${instrument.scale.points}`,
        });
      }
    }
    const extraKeys = Object.keys(answers).filter((k) => !allItems.some((item) => item.id === k));
    if (extraKeys.length > 0) {
      return res.status(400).json({ error: `unknown item ids in answers: ${extraKeys.join(', ')}` });
    }

    if (phase === 'debrief') {
      if (!extras || typeof extras !== 'object') {
        return res.status(400).json({ error: 'extras is required for debrief submissions' });
      }
      const pxItems = instrument.debrief_extras.post_experience.items;
      const pxAnswers = extras.post_experience || {};
      for (const item of pxItems) {
        const v = pxAnswers[item.id];
        if (!Number.isInteger(v) || v < 1 || v > instrument.scale.points) {
          return res.status(400).json({
            error: `extras.post_experience.${item.id} must be an integer between 1 and ${instrument.scale.points}`,
          });
        }
      }
      const openItems = instrument.debrief_extras.open_ended;
      const openAnswers = extras.open_ended || {};
      for (const q of openItems) {
        const v = openAnswers[q.id];
        if (typeof v !== 'string' || v.trim().length < 40) {
          return res.status(400).json({
            error: `extras.open_ended.${q.id} must be a string of at least 40 characters`,
          });
        }
      }
    }

    const participantId = identity.deriveParticipantId(ident.email, process.env.CHECKIN_HMAC_SECRET);
    const emailEncrypted = identity.encryptEmail(ident.email, process.env.CHECKIN_AES_KEY);
    await checkinDb.upsertParticipant(participantId, emailEncrypted, 'email');

    const supersedes = await checkinDb.findLatestResponseId(participantId, course, moduleNum, phase);
    const straightlineFlag = scoring.isStraightline(instrument, answers);
    const scoredItems = scoring.scoreAllItems(instrument, answers);
    const subscaleScores = scoring.computeSubscaleScores(instrument, answers);
    const submittedAt = new Date().toISOString();

    const code = completionCode.generateCompletionCode({
      abbrev: instrument.abbrev,
      module: moduleNum,
      phase,
      course,
      participantId,
      submittedAt,
      secret: process.env.CHECKIN_HMAC_SECRET,
    });

    await checkinDb.insertResponse({
      course,
      module: moduleNum,
      phase,
      participantId,
      instrumentVersion: instrument.version,
      startedAt: started_at,
      straightlineFlag,
      supersedes,
      completionCode: code,
      itemsJson: answers,
      extrasJson: phase === 'debrief' ? extras : null,
      scoredItems,
      subscaleScores,
    });

    res.json({ completion_code: code, subscale_means: subscaleScores });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 4: Mount the router in `server/index.js`**

Open `server/index.js`. Add the require near the top, after the existing `db` require:

```javascript
const { getPool, isAvailable, initSchema } = require('./db');
const checkinRoutes = require('./checkin/routes');
```

Then, immediately after the `app.set('trust proxy', 1);` line and before `app.use(express.json({ limit: '1mb' }));`, mount the check-in router:

```javascript
app.use('/api', checkinRoutes);
```

The exact position relative to the app's own `express.json({limit:'1mb'})` doesn't affect correctness now that the check-in router's own body limit and rate limiter are per-route middleware (see the note above `router.get('/instrument/...')` in Step 3) rather than router-level -- there's no cross-router body-parsing interaction to order around. Placing it here, right after `trust proxy`, is just about keeping new routes grouped together near the top of the file for readability.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && npx jest tests/checkin.routes.test.js`
Expected: `Tests: 16 passed, 16 total` (count the `test(...)` blocks in Step 1's code above if this ever drifts -- treat the actual test file as authoritative over any number stated here).

- [ ] **Step 6: Run the full suite to check for regressions**

Run: `cd server && npm test`
Expected: all suites pass, including the original 32 tests (the existing `/api/sessions` etc. routes are untouched; check-in routes are additive under the same `/api` prefix but distinct paths). Also worth adding at this point, even though it's not in Step 1's test code above: two regression tests proving the per-route middleware scoping in Step 3 actually works -- one asserting a >64KB body to an existing route like `/api/chat` is NOT rejected by check-in's 64KB limit, and one asserting hammering an existing route like `/api/log` past 30 requests is NOT blocked by check-in's rate limiter. An earlier draft of this task used router-level `.use()` instead of per-route middleware and broke body parsing/rate limiting for every other `/api/*` route in the app; these tests are what catches that class of regression if it's ever reintroduced.

- [ ] **Step 7: Commit**

```bash
git add server/checkin/routes.js server/index.js server/tests/checkin.routes.test.js
git commit -m "feat: add check-in API routes (GET instrument, POST responses)"
```

---

### Task 10: Boot-time wiring (schema init, instrument load, loud non-fatal validation)

**Files:**
- Modify: `server/index.js`

This task makes the server actually initialize check-in's Postgres schema and load+validate instruments at startup, logging loudly (not silently) if instruments are broken.

**Important, learned the hard way in this session's own execution:** do NOT `process.exit(1)` on a bad instrument file. Sim is a live production app serving real ERAU students, and chat/sessions/the SPA don't depend on instrument files at all -- crashing the whole process over a check-in-only content error (the kind of typo likely during the future migration of the other 9 instrument files, hand-authored content with no CI gate blocking a bad deploy) takes down the entire app over a fault confined to one new, additive feature. Express 4 already catches synchronous throws inside route handlers and returns a 500 for just that request, so log loudly and keep booting -- check-in's own two routes degrade to per-request 500s until the file is fixed and redeployed, exactly like the app already handles Postgres being unavailable (503, not a crash) for the DB-backed routes.

- [ ] **Step 1: Add the instrument loader require**

In `server/index.js`, add near the other checkin require:

```javascript
const instrumentLoader = require('./checkin/instrumentLoader');
const checkinDb = require('./checkin/db');
```

- [ ] **Step 2: Replace the boot block to initialize both schemas and load instruments**

Find this existing block near the bottom of `server/index.js`:

```javascript
// Only start listening when run directly (not when imported by tests)
if (require.main === module) {
  initSchema().then(() => {
    app.listen(PORT, () => {
      console.log(`OBLD 500 Simulation Suite running on port ${PORT}`);
    });
  });
}
```

Replace it with:

```javascript
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
```

The trailing `.catch()` on `Promise.all(...).then(...)` is defensive symmetry: `initSchema()` and `checkinDb.initCheckinSchema()` both already swallow their own errors internally and always resolve (never reject), so this can't fire today -- but if that ever changes, an unhandled rejection here would otherwise silently hang the server with no log line and no listener ever starting. A genuinely unexpected startup failure at this layer (as opposed to a known, already-handled "no DATABASE_URL" case) is a different risk category from a bad instrument file, and `process.exit(1)` here is the right call for it.

- [ ] **Step 3: Run the full test suite**

Run: `cd server && npm test`
Expected: all suites still pass. (Tests import `index.js` without `require.main === module` being true under Jest, so this boot block does not run during tests -- consistent with how `initSchema()` already worked before this change.)

- [ ] **Step 4: Manually verify the degraded (non-fatal) behavior**

Run: `cd server && CHECKIN_INSTRUMENT_DIR=/nonexistent node index.js &` (background it).
Expected: the process logs `[CheckIn] Instrument validation failed at boot -- check-in endpoints will error until this is fixed and redeployed:` followed by an ENOENT message, THEN still logs the normal `OBLD 500 Simulation Suite running on port 3000` line and keeps running (confirm with `ps` or similar that it's still alive, not exited).

While it's running, confirm the failure is genuinely scoped: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/instrument/OBLD500/4/baseline` should print `500` (check-in's own route failing per-request, as expected), while `curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/log -H "Content-Type: application/json" -d '{}'` should print `200` (an unrelated existing route, completely unaffected). Then stop the background process.

Also re-verify the successful-boot case still works: `cd server && CHECKIN_HMAC_SECRET=test CHECKIN_AES_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))") node index.js &` (default, valid instruments dir) should log `[CheckIn] Instruments loaded and validated` then the normal startup line. Stop it afterward.

- [ ] **Step 5: Commit**

```bash
git add server/index.js
git commit -m "feat: load and validate check-in instruments at boot, degrade check-in only on error"
```

---

### Task 11: Environment and documentation

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document the new env vars**

Add to `.env.example`, after the existing `PORT` line:

```
# Required for the check-in module (Baseline/Debrief instruments)
# HMAC secret used to derive participant ids and completion codes. Any
# non-empty string; rotating it invalidates all completion codes issued
# before the rotation.
CHECKIN_HMAC_SECRET=change-me-to-a-long-random-string

# AES-256 key (base64, must decode to exactly 32 bytes) used to encrypt
# stored learner emails at rest. Generate one with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
CHECKIN_AES_KEY=change-me-to-a-base64-32-byte-key

# Optional: directory of instrument JSON files (default: server/checkin/instruments)
CHECKIN_INSTRUMENT_DIR=
```

- [ ] **Step 2: Add a Check-In Module section to README.md**

Add this new section to `README.md`, after the existing "## Persistence (PostgreSQL)" section:

```markdown
## Check-In Module (Baseline / Debrief)

Replaces the Google Forms baseline/debrief instruments with a check-in flow
inside Sim itself. Learners open `https://sim.ldrcoach.com/?week={N}&mode=baseline`
or `?week={N}&mode=debrief`, answer a 20-item instrument (plus, on Debrief,
5 post-experience items and 3 open-ended prompts), and get a completion code
to paste into the matching Canvas assignment.

**Storage:** the `checkin_*` tables in the same Postgres database used for
session persistence (see above) -- not a separate database, and not SQLite
(Sim's Azure Container Apps filesystem does not persist across redeploys).

**Instruments:** one JSON file per module under `server/checkin/instruments/`,
validated at server boot (a bad file logs loudly but the app keeps running --
only check-in's own routes degrade, not the whole app). Only
`AL.json` (Module 4, Active Listening) exists today, as a development fixture
-- migrating the real 18 Google Forms into the remaining 9 module files is a
separate, not-yet-started task.

**Endpoints:**
- `GET /api/instrument/:course/:module/:phase` -- public instrument view (no reverse-scoring flags)
- `POST /api/responses` -- submit a Baseline or Debrief response, returns a completion code

**Not yet built** (see `docs/superpowers/plans/2026-09-13-checkin-module.md`
for the full scope decisions): the admin API (verify/summary/export/delete),
the "then and now" comparison panel, `key`/`none` identity modes, and the
real instrument migration.
```

- [ ] **Step 3: Update CLAUDE.md's Repository Structure section**

In `CLAUDE.md`, find the `server/` line in the Repository Structure code block and add a line beneath it:

```
server/             # Express API proxy + persistence
  index.js          # Proxies /api/chat to Anthropic, persistence endpoints
  checkin/          # Baseline/Debrief check-in module (see README's Check-In Module section)
```

- [ ] **Step 4: Commit**

```bash
git add .env.example README.md CLAUDE.md
git commit -m "docs: document the check-in module env vars and endpoints"
```

---

### Task 12: Client -- fetch instrument, Intro screen, and URL entry point

**Files:**
- Modify: `client/src/App.jsx`
- Create: `client/src/CheckIn.jsx`

This codebase has no client-side test runner (only the server has Jest configured) and no existing multi-file component split to follow -- `App.jsx` is one 2188-line file. This plan does not introduce a new testing framework unilaterally; verification for the client tasks is manual (build + browser), consistent with how this session verified Sim's own redeploy. `CheckIn.jsx` is one file, matching `App.jsx`'s own single-large-component convention.

- [ ] **Step 1: Export the color palette from App.jsx**

In `client/src/App.jsx`, find:

```javascript
const C = {
```

Change it to:

```javascript
export const C = {
```

- [ ] **Step 2: Create CheckIn.jsx with the data-fetching shell and Intro screen**

Create `client/src/CheckIn.jsx`:

```jsx
import { useState, useEffect, useCallback } from "react";
import { C } from "./App";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function LoadingScreen() {
  return (
    <div style={{ padding: 40, textAlign: "center", color: C.midGray }}>
      Loading...
    </div>
  );
}

function ErrorScreen({ message }) {
  return (
    <div style={{ padding: 40, maxWidth: 600, margin: "0 auto" }}>
      <div style={{ background: C.dangerBg, color: C.danger, padding: 20, borderRadius: 8 }}>
        {message}
      </div>
    </div>
  );
}

function IntroScreen({ instrument, moduleNum, phase, email, setEmail, onStart }) {
  const [touched, setTouched] = useState(false);
  const emailValid = EMAIL_RE.test(email.trim());

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

      <label htmlFor="checkin-email" style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
        Your ERAU email
      </label>
      <input
        id="checkin-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onBlur={() => setTouched(true)}
        style={{
          width: "100%", padding: 12, fontSize: 16, borderRadius: 6,
          border: `1px solid ${touched && !emailValid ? C.danger : C.lightGray}`,
          marginBottom: 6,
        }}
        aria-describedby={touched && !emailValid ? "email-error" : undefined}
      />
      {touched && !emailValid && (
        <p id="email-error" style={{ color: C.danger, fontSize: 13, marginBottom: 12 }}>
          Enter a valid email address.
        </p>
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
        disabled={!emailValid}
        style={{
          padding: "12px 28px", fontSize: 16, borderRadius: 6, border: "none",
          background: emailValid ? C.navy : C.lightGray,
          color: emailValid ? C.white : C.midGray,
          cursor: emailValid ? "pointer" : "not-allowed",
          minHeight: 44,
        }}
      >
        Start
      </button>
    </div>
  );
}

export default function CheckIn({ moduleNum, phase }) {
  const course = "OBLD500";
  const [status, setStatus] = useState("loading"); // loading | error | intro
  const [errorMessage, setErrorMessage] = useState("");
  const [instrument, setInstrument] = useState(null);
  const [email, setEmail] = useState("");

  const loadInstrument = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch(`/api/instrument/${course}/${moduleNum}/${phase}`);
      if (!res.ok) {
        throw new Error(res.status === 404 ? "No check-in found for this module." : `Error ${res.status}`);
      }
      const data = await res.json();
      setInstrument(data);
      setStatus("intro");
    } catch (err) {
      setErrorMessage(err.message);
      setStatus("error");
    }
  }, [course, moduleNum, phase]);

  useEffect(() => { loadInstrument(); }, [loadInstrument]);

  if (status === "loading") return <LoadingScreen />;
  if (status === "error") return <ErrorScreen message={errorMessage} />;

  return (
    <IntroScreen
      instrument={instrument}
      moduleNum={moduleNum}
      phase={phase}
      email={email}
      setEmail={setEmail}
      onStart={() => { /* wired up in Task 13 */ }}
    />
  );
}
```

- [ ] **Step 3: Wire the URL entry point and view into App.jsx**

In `client/src/App.jsx`, add the import near the top (after the existing `import { useState, ...} from "react";` line):

```javascript
import CheckIn from "./CheckIn";
```

First, add a module-scope helper function above `export default function App() {` (near the other top-level constants like `WEEK_ORDER`), so the URL-parsing rule lives in exactly one place rather than being duplicated across the two `useState` initializers below:

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

Inside `export default function App() {`, right after the existing `const [view, setView] = useState("landing");` line, add the query-param parsing (runs once, on first render):

```javascript
const [checkinParams] = useState(() => parseCheckinParams());
```

Then change the initial view: replace

```javascript
const [view, setView] = useState("landing");
```

with

```javascript
const [view, setView] = useState(() => (parseCheckinParams() ? "checkin" : "landing"));
```

(Both `useState` initializers call `parseCheckinParams()` independently since `window.location.search` does not change during the component's lifetime for this flow -- this avoids a stale closure between the two states, while keeping the actual parsing rule in one shared function instead of two copies that could silently drift apart.)

Finally, in the return block, add a `checkin` branch. Find:

```jsx
{view === "landing" && <LandingPage mode={mode} setMode={setMode} onSelectSim={selectSim} onSelectObs={selectObs} />}
```

and add immediately before it:

```jsx
{view === "checkin" && checkinParams && (
  <CheckIn moduleNum={checkinParams.moduleNum} phase={checkinParams.phase} />
)}
```

- [ ] **Step 4: Manual verification**

Run: `cd client && npm run dev` (in one terminal) and `cd server && node index.js` (in another, with `CHECKIN_HMAC_SECRET`/`CHECKIN_AES_KEY` set in `server/.env` per `.env.example`).

Open `http://localhost:5173/?week=4&mode=baseline` in a browser.
Expected: the Intro screen renders with the Module 4 / Active Listening topic, the 7-point scale legend, and an email field. The Start button is disabled until a validly-formatted email is entered.

Open `http://localhost:5173/?week=4&mode=debrief`.
Expected: same screen, phase label reads "debrief".

Open `http://localhost:5173/?week=99&mode=baseline` (a module with no instrument).
Expected: the error screen renders ("No check-in found for this module.").

- [ ] **Step 5: Commit**

```bash
git add client/src/App.jsx client/src/CheckIn.jsx
git commit -m "feat: add check-in Intro screen and ?week=/mode= URL entry point"
```

---

### Task 13: Client -- subscale screens

**Files:**
- Modify: `client/src/CheckIn.jsx`

- [ ] **Step 1: Add a reusable Likert item and subscale screen component**

In `client/src/CheckIn.jsx`, add these components above `export default function CheckIn`:

```jsx
function LikertItem({ item, value, onChange, scaleLabels, firstInputRef }) {
  return (
    <fieldset style={{ border: "none", borderBottom: `1px solid ${C.lightGray}`, padding: "16px 0", margin: 0 }}>
      <legend style={{ fontSize: 16, marginBottom: 12, padding: 0 }}>{item.text}</legend>
      <div className="checkin-radio-row" role="radiogroup" aria-label={item.text}>
        {scaleLabels.map((label, i) => {
          const optionValue = i + 1;
          const inputId = `${item.id}-${optionValue}`;
          return (
            <label
              key={optionValue}
              htmlFor={inputId}
              className="checkin-radio-option"
              style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                gap: 4, fontSize: 12, color: C.textSec, textAlign: "center",
                cursor: "pointer", minHeight: 44, justifyContent: "center",
              }}
            >
              <input
                id={inputId}
                ref={i === 0 ? firstInputRef : undefined}
                type="radio"
                name={item.id}
                value={optionValue}
                checked={value === optionValue}
                onChange={() => onChange(item.id, optionValue)}
                style={{ width: 20, height: 20 }}
              />
              {label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function SubscaleScreen({ subscale, scaleLabels, answers, onAnswer, onNext, onBack, progressText }) {
  const allAnswered = subscale.items.every((item) => answers[item.id] != null);
  const [triedNext, setTriedNext] = useState(false);
  const firstUnansweredRef = useRef(null);
  const firstUnansweredItem = subscale.items.find((item) => answers[item.id] == null);
  const firstUnansweredId = firstUnansweredItem ? firstUnansweredItem.id : null;

  // Focus must move AFTER React commits the DOM, not during the click handler
  // (the ref for the just-revealed error state isn't populated yet at that
  // point) or via a ref read during render (which reflects the previous
  // commit, not this one). A useEffect keyed on the derived "first
  // unanswered" value is what actually works here.
  useEffect(() => {
    if (triedNext && firstUnansweredId && firstUnansweredRef.current) {
      firstUnansweredRef.current.focus();
    }
  }, [triedNext, firstUnansweredId]);

  const handleNext = () => {
    if (!allAnswered) {
      setTriedNext(true);
      return;
    }
    onNext();
  };

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px" }}>
      <p aria-live="polite" style={{ fontSize: 13, color: C.midGray, marginBottom: 8 }}>
        {progressText}
      </p>
      <h2 style={{ fontSize: 20, color: C.navy, marginBottom: 4 }}>{subscale.name}</h2>
      <p style={{ color: C.textSec, marginBottom: 16 }}>{subscale.help}</p>

      {subscale.items.map((item) => (
        <LikertItem
          key={item.id}
          item={item}
          value={answers[item.id]}
          onChange={onAnswer}
          scaleLabels={scaleLabels}
          firstInputRef={item.id === firstUnansweredId ? firstUnansweredRef : undefined}
        />
      ))}

      {triedNext && !allAnswered && (
        <p role="alert" style={{ color: C.danger, fontSize: 13, margin: "12px 0" }}>
          Please answer every item before continuing.
        </p>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20 }}>
        <button onClick={onBack} style={{ padding: "10px 20px", borderRadius: 6, border: `1px solid ${C.lightGray}`, background: C.white, minHeight: 44 }}>
          Back
        </button>
        <button
          onClick={handleNext}
          style={{
            padding: "10px 24px", borderRadius: 6, border: "none", minHeight: 44,
            background: C.navy, color: C.white, cursor: "pointer",
          }}
        >
          Next
        </button>
      </div>
    </div>
  );
}
```

An earlier draft of this task focused a wrapper `<div>` synchronously inside the click handler, read via `ref.current` during render. Neither works: the div has no `tabIndex` so it can't receive programmatic focus at all, and reading `.current` during render reflects the previous commit, not the one in progress -- confirmed non-functional by driving the app in a real browser during code review. The version above fixes both by targeting an actual focusable element (the first radio input, via `LikertItem`'s new `firstInputRef` prop) and moving the `.focus()` call into a `useEffect` that runs after commit.

Add `useRef` to the existing React import at the top of the file:

```javascript
import { useState, useEffect, useCallback, useRef } from "react";
```

- [ ] **Step 2: Add the responsive radio-row CSS**

At the very top of `CheckIn.jsx`'s JSX output (inside the outer wrapping element -- see Step 3), the plan needs one small piece of CSS that inline styles cannot express: a media query so options stack vertically under 480px, per spec section 10's 360px-width requirement. Add this constant near the top of the file, below the imports:

```javascript
const RESPONSIVE_STYLE = `
  .checkin-radio-row { display: flex; gap: 12px; justify-content: space-between; }
  @media (max-width: 480px) {
    .checkin-radio-row { flex-direction: column; align-items: stretch; gap: 0; }
    .checkin-radio-option { flex-direction: row !important; justify-content: flex-start !important; gap: 12px !important; padding: 8px 0; }
  }
`;
```

- [ ] **Step 3: Wire subscale navigation into the CheckIn component**

Replace the body of `export default function CheckIn({ moduleNum, phase }) {` (from Task 12) with the version below, which adds `answers` state and subscale index navigation:

```jsx
export default function CheckIn({ moduleNum, phase }) {
  const course = "OBLD500";
  const [status, setStatus] = useState("loading"); // loading | error | intro | subscale
  const [errorMessage, setErrorMessage] = useState("");
  const [instrument, setInstrument] = useState(null);
  const [email, setEmail] = useState("");
  const [answers, setAnswers] = useState({});
  const [subscaleIndex, setSubscaleIndex] = useState(0);

  const loadInstrument = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch(`/api/instrument/${course}/${moduleNum}/${phase}`);
      if (!res.ok) {
        throw new Error(res.status === 404 ? "No check-in found for this module." : `Error ${res.status}`);
      }
      const data = await res.json();
      setInstrument(data);
      setStatus("intro");
    } catch (err) {
      setErrorMessage(err.message);
      setStatus("error");
    }
  }, [course, moduleNum, phase]);

  useEffect(() => { loadInstrument(); }, [loadInstrument]);

  const handleAnswer = (itemId, value) => {
    setAnswers((prev) => ({ ...prev, [itemId]: value }));
  };

  if (status === "loading") return <LoadingScreen />;
  if (status === "error") return <ErrorScreen message={errorMessage} />;

  return (
    <>
      <style>{RESPONSIVE_STYLE}</style>
      {status === "intro" && (
        <IntroScreen
          instrument={instrument}
          moduleNum={moduleNum}
          phase={phase}
          email={email}
          setEmail={setEmail}
          onStart={() => setStatus("subscale")}
        />
      )}
      {status === "subscale" && (
        <SubscaleScreen
          key={instrument.subscales[subscaleIndex].id}
          subscale={instrument.subscales[subscaleIndex]}
          scaleLabels={instrument.scale.labels}
          answers={answers}
          onAnswer={handleAnswer}
          progressText={`Section ${subscaleIndex + 1} of ${instrument.subscales.length}`}
          onBack={() => {
            if (subscaleIndex === 0) setStatus("intro");
            else setSubscaleIndex((i) => i - 1);
          }}
          onNext={() => {
            if (subscaleIndex < instrument.subscales.length - 1) {
              setSubscaleIndex((i) => i + 1);
            } else {
              setStatus(phase === "debrief" ? "post-experience" : "review");
            }
          }}
        />
      )}
      {status === "post-experience" && <LoadingScreen />}
      {status === "review" && <LoadingScreen />}
    </>
  );
}
```

(The `post-experience` and `review` placeholders render `<LoadingScreen />` only until Tasks 14-15 replace them -- this is intentional scaffolding within one in-progress task's steps, not a shipped placeholder; Step 4 verifies the subscale flow specifically, and later tasks replace both branches before this feature is considered done.)

- [ ] **Step 4: Manual verification**

With both dev servers running (per Task 12 Step 4), open `http://localhost:5173/?week=4&mode=baseline`.

1. Enter a valid email, click Start.
2. Expected: "Section 1 of 4", the Sensing subscale's help text, and 5 fieldsets each with 7 radio options.
3. Click Next without answering anything. Expected: an inline "Please answer every item before continuing." message, and focus moves to the first unanswered item.
4. Answer all 5 items, click Next. Expected: advances to "Section 2 of 4" (Attending).
5. Click Back. Expected: returns to Section 1 with previous answers still selected.
6. Resize the browser to 360px wide (or use dev tools device emulation). Expected: the 7 radio options stack vertically with labels fully visible, no horizontal scrollbar.
7. Advance through all 4 subscales. Expected: after Section 4, the screen goes blank (loading spinner) -- this is the Task 14/15 placeholder; that is expected at this point in the plan.

- [ ] **Step 5: Commit**

```bash
git add client/src/CheckIn.jsx
git commit -m "feat: add check-in subscale screens with keyboard-accessible Likert items"
```

---

### Task 14: Client -- debrief extras (post-experience + open-ended)

**Files:**
- Modify: `client/src/CheckIn.jsx`

- [ ] **Step 1: Add the PostExperienceScreen and OpenEndedScreen components**

Add these above `export default function CheckIn`, near the other screen components:

```jsx
function PostExperienceScreen({ items, scaleLabels, answers, onAnswer, onNext, onBack }) {
  const allAnswered = items.every((item) => answers[item.id] != null);
  const [triedNext, setTriedNext] = useState(false);
  const firstUnansweredRef = useRef(null);
  const firstUnansweredItem = items.find((item) => answers[item.id] == null);
  const firstUnansweredId = firstUnansweredItem ? firstUnansweredItem.id : null;

  // Same pattern as SubscaleScreen (Task 13): this screen has the identical
  // validation shape and reuses LikertItem, so it needs the identical
  // focus-on-validation-failure fix -- an earlier draft omitted it here,
  // a real accessibility parity gap caught by code review and confirmed
  // live in a browser before being ported over.
  useEffect(() => {
    if (triedNext && firstUnansweredId && firstUnansweredRef.current) {
      firstUnansweredRef.current.focus();
    }
  }, [triedNext, firstUnansweredId]);

  const handleNext = () => {
    if (!allAnswered) {
      setTriedNext(true);
      return;
    }
    onNext();
  };

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px" }}>
      <p aria-live="polite" style={{ fontSize: 13, color: C.midGray, marginBottom: 8 }}>
        Reflecting on the module
      </p>
      <h2 style={{ fontSize: 20, color: C.navy, marginBottom: 16 }}>Post-Experience Reflection</h2>

      {items.map((item) => (
        <LikertItem
          key={item.id}
          item={item}
          value={answers[item.id]}
          onChange={onAnswer}
          scaleLabels={scaleLabels}
          firstInputRef={item.id === firstUnansweredId ? firstUnansweredRef : undefined}
        />
      ))}

      {triedNext && !allAnswered && (
        <p role="alert" style={{ color: C.danger, fontSize: 13, margin: "12px 0" }}>
          Please answer every item before continuing.
        </p>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20 }}>
        <button onClick={onBack} style={{ padding: "10px 20px", borderRadius: 6, border: `1px solid ${C.lightGray}`, background: C.white, minHeight: 44 }}>
          Back
        </button>
        <button
          onClick={handleNext}
          style={{ padding: "10px 24px", borderRadius: 6, border: "none", minHeight: 44, background: C.navy, color: C.white, cursor: "pointer" }}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function OpenEndedScreen({ prompts, answers, onAnswer, onNext, onBack }) {
  const MIN_LENGTH = 40;
  const allValid = prompts.every((p) => (answers[p.id] || "").trim().length >= MIN_LENGTH);
  const [triedNext, setTriedNext] = useState(false);

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px" }}>
      <h2 style={{ fontSize: 20, color: C.navy, marginBottom: 16 }}>A Few Reflection Questions</h2>

      {prompts.map((p) => {
        const text = answers[p.id] || "";
        const tooShort = text.trim().length < MIN_LENGTH;
        return (
          <div key={p.id} style={{ marginBottom: 24 }}>
            <label htmlFor={p.id} style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
              {p.prompt}
            </label>
            <textarea
              id={p.id}
              value={text}
              onChange={(e) => onAnswer(p.id, e.target.value)}
              rows={4}
              style={{
                width: "100%", padding: 10, fontSize: 15, borderRadius: 6,
                border: `1px solid ${triedNext && tooShort ? C.danger : C.lightGray}`,
                fontFamily: "inherit",
              }}
              aria-describedby={`${p.id}-count`}
            />
            <p id={`${p.id}-count`} style={{ fontSize: 12, color: tooShort ? C.danger : C.midGray, marginTop: 4 }}>
              {text.trim().length} / {MIN_LENGTH} characters minimum
            </p>
          </div>
        );
      })}

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
        <button onClick={onBack} style={{ padding: "10px 20px", borderRadius: 6, border: `1px solid ${C.lightGray}`, background: C.white, minHeight: 44 }}>
          Back
        </button>
        <button
          onClick={() => (allValid ? onNext() : setTriedNext(true))}
          style={{ padding: "10px 24px", borderRadius: 6, border: "none", minHeight: 44, background: C.navy, color: C.white, cursor: "pointer" }}
        >
          Next
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the two screens into the CheckIn component**

In `client/src/CheckIn.jsx`, add `pxAnswers` and `openAnswers` state alongside the existing `answers` state:

```javascript
const [pxAnswers, setPxAnswers] = useState({});
const [openAnswers, setOpenAnswers] = useState({});
```

Replace the `{status === "post-experience" && <LoadingScreen />}` and `{status === "review" && <LoadingScreen />}` lines from Task 13 with:

```jsx
{status === "post-experience" && (
  <PostExperienceScreen
    items={instrument.debrief_extras.post_experience.items}
    scaleLabels={instrument.scale.labels}
    answers={pxAnswers}
    onAnswer={(id, v) => setPxAnswers((prev) => ({ ...prev, [id]: v }))}
    onBack={() => setStatus("subscale")}
    onNext={() => setStatus("open-ended")}
  />
)}
{status === "open-ended" && (
  <OpenEndedScreen
    prompts={instrument.debrief_extras.open_ended}
    answers={openAnswers}
    onAnswer={(id, v) => setOpenAnswers((prev) => ({ ...prev, [id]: v }))}
    onBack={() => setStatus("post-experience")}
    onNext={() => setStatus("review")}
  />
)}
{status === "review" && <LoadingScreen />}
```

Note: going "Back" from post-experience returns to `"subscale"`, which will show the last subscale (index is unchanged from when the learner left it) -- this matches spec section 5's "the Back button on each screen works."

- [ ] **Step 3: Manual verification**

Open `http://localhost:5173/?week=4&mode=debrief`, enter an email, click Start, and answer all 4 subscales.

Expected: after the last subscale, the Post-Experience Reflection screen appears with 5 Likert items. Answer all 5, click Next.

Expected: the open-ended screen appears with 3 textareas, each showing a live "X / 40 characters minimum" counter that turns from red to normal once 40 characters are typed. Next stays effectively blocked (via the `triedNext` message) until all three reach 40 characters.

Click Back from the open-ended screen. Expected: returns to Post-Experience with prior answers intact.

- [ ] **Step 4: Commit**

```bash
git add client/src/CheckIn.jsx
git commit -m "feat: add check-in debrief post-experience and open-ended screens"
```

---

### Task 15: Client -- review, submit, and confirmation

**Files:**
- Modify: `client/src/CheckIn.jsx`

- [ ] **Step 1: Add the ReviewScreen and ConfirmationScreen components**

Add above `export default function CheckIn`:

```jsx
function ReviewScreen({ instrument, phase, answeredCounts, onSubmit, onBack, submitting, submitError }) {
  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px" }}>
      <h2 style={{ fontSize: 20, color: C.navy, marginBottom: 16 }}>Review</h2>

      <ul style={{ listStyle: "none", padding: 0, marginBottom: 20 }}>
        {answeredCounts.map((section) => (
          <li
            key={section.label}
            style={{
              display: "flex", justifyContent: "space-between", padding: "10px 0",
              borderBottom: `1px solid ${C.lightGray}`,
            }}
          >
            <span>{section.label}</span>
            <span style={{ color: section.answered === section.total ? C.success : C.danger }}>
              answered {section.answered} of {section.total}
            </span>
          </li>
        ))}
      </ul>

      {submitError && (
        <p role="alert" style={{ color: C.danger, marginBottom: 12 }}>{submitError}</p>
      )}

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button onClick={onBack} disabled={submitting} style={{ padding: "10px 20px", borderRadius: 6, border: `1px solid ${C.lightGray}`, background: C.white, minHeight: 44 }}>
          Back
        </button>
        <button
          onClick={onSubmit}
          disabled={submitting}
          style={{
            padding: "10px 24px", borderRadius: 6, border: "none", minHeight: 44,
            background: submitting ? C.lightGray : C.navy, color: submitting ? C.midGray : C.white,
            cursor: submitting ? "default" : "pointer",
          }}
        >
          {submitting ? "Submitting..." : "Submit"}
        </button>
      </div>
    </div>
  );
}

function ConfirmationScreen({ completionText, moduleNum, completionCode }) {
  const [copyState, setCopyState] = useState("idle"); // idle | copied | failed
  const text = completionText.replace("{module}", moduleNum);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(completionCode);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  const buttonLabel =
    copyState === "copied" ? "Copied!" : copyState === "failed" ? "Copy failed" : "Copy code";

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px", textAlign: "center" }}>
      <h2 style={{ fontSize: 20, color: C.navy, marginBottom: 16 }}>Complete</h2>
      <p style={{ marginBottom: 24, lineHeight: 1.6 }}>{text}</p>

      <div style={{
        fontFamily: "monospace", fontSize: 24, letterSpacing: 2, background: C.lightGray,
        borderRadius: 8, padding: "16px 20px", marginBottom: 12, wordBreak: "break-all",
      }}>
        {completionCode}
      </div>

      <button
        onClick={handleCopy}
        style={{
          padding: "10px 24px", borderRadius: 6, border: "none", minHeight: 44,
          background: C.navy, color: C.white, cursor: "pointer",
        }}
      >
        {buttonLabel}
      </button>

      {copyState === "failed" && (
        <p role="alert" style={{ color: C.danger, fontSize: 13, marginTop: 8 }}>
          Couldn't copy automatically. Select the code above and copy it manually.
        </p>
      )}
    </div>
  );
}
```

A no-op `copied ? ... : ...` boolean (the catch branch just re-set `false`, which it already was) previously left the learner with zero feedback on a failed clipboard write -- plausible in a Canvas iframe embed, non-HTTPS context, or denied permission. The three-state version above, confirmed live in a browser during code review (a forced clipboard rejection correctly showed "Copy failed" plus the fallback instruction), fixes that.

- [ ] **Step 2: Wire straightlining confirmation, submit, and confirmation state**

In `client/src/CheckIn.jsx`, add state for submission:

```javascript
const [submitting, setSubmitting] = useState(false);
const [submitError, setSubmitError] = useState(null);
const [straightlineConfirmed, setStraightlineConfirmed] = useState(false);
const [result, setResult] = useState(null);
const [startedAt, setStartedAt] = useState(null);
```

Capture `startedAt` when the learner clicks Start on the Intro screen -- update the `onStart` prop passed to `IntroScreen`:

```javascript
onStart={() => { setStartedAt(new Date().toISOString()); setStatus("subscale"); }}
```

Also update `handleAnswer` (defined back in Task 13, before `straightlineConfirmed` existed) so it resets the confirmation whenever a core item's answer changes:

```javascript
const handleAnswer = (itemId, value) => {
  setAnswers((prev) => ({ ...prev, [itemId]: value }));
  setStraightlineConfirmed(false);
};
```

Without this, once a learner confirms the straightline warning on one submit attempt, it stays confirmed for the rest of the session -- so if that submission fails and they go back and edit into a *different* straightlined pattern, the warning silently never reappears for data they never actually confirmed. Confirmed live in a browser during code review: edit-then-resubmit-unchanged correctly does NOT re-prompt (no needless nagging), but edit-into-a-new-straightlined-pattern-then-resubmit correctly DOES re-prompt. No equivalent change is needed on the `pxAnswers`/`openAnswers` setters -- `isStraightlineLocal()` below only ever reads `answers`.

Add the submit handler as a function inside `CheckIn`, above the `return`:

```javascript
const isStraightlineLocal = () => {
  const allItems = instrument.subscales.flatMap((s) => s.items);
  const values = allItems.map((item) => answers[item.id]);
  return values.every((v) => v === values[0]);
};

const doSubmit = async () => {
  setSubmitting(true);
  setSubmitError(null);
  try {
    const body = {
      course,
      module: moduleNum,
      phase,
      identity: { email: email.trim() },
      started_at: startedAt,
      answers,
      ...(phase === "debrief" ? { extras: { post_experience: pxAnswers, open_ended: openAnswers } } : {}),
    };
    const res = await fetch("/api/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      if (res.status >= 400 && res.status < 500) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Error ${res.status}`);
      }
      throw new Error("Something went wrong submitting your check-in. Please try again.");
    }
    const data = await res.json();
    setResult(data);
    setStatus("confirmation");
  } catch (err) {
    setSubmitError(err.message);
  } finally {
    setSubmitting(false);
  }
};

const handleSubmitClick = () => {
  if (!straightlineConfirmed && isStraightlineLocal()) {
    const proceed = window.confirm("You answered every item the same way. Submit anyway?");
    if (!proceed) return;
    setStraightlineConfirmed(true);
  }
  doSubmit();
};
```

Replace `{status === "review" && <LoadingScreen />}` with:

```jsx
{status === "review" && (
  <ReviewScreen
    instrument={instrument}
    phase={phase}
    answeredCounts={[
      ...instrument.subscales.map((s) => ({
        label: s.name,
        answered: s.items.filter((item) => answers[item.id] != null).length,
        total: s.items.length,
      })),
      ...(phase === "debrief" ? [
        {
          label: "Post-Experience Reflection",
          answered: instrument.debrief_extras.post_experience.items.filter((item) => pxAnswers[item.id] != null).length,
          total: instrument.debrief_extras.post_experience.items.length,
        },
        {
          label: "Reflection Questions",
          answered: instrument.debrief_extras.open_ended.filter((p) => (openAnswers[p.id] || "").trim().length >= 40).length,
          total: instrument.debrief_extras.open_ended.length,
        },
      ] : []),
    ]}
    onSubmit={handleSubmitClick}
    onBack={() => setStatus(phase === "debrief" ? "open-ended" : "subscale")}
    submitting={submitting}
    submitError={submitError}
  />
)}
{status === "confirmation" && result && (
  <ConfirmationScreen
    completionText={instrument.completion}
    moduleNum={moduleNum}
    completionCode={result.completion_code}
  />
)}
```

`instrument.completion` is already phase-specific by this point: the server's `GET /api/instrument/:course/:module/:phase` (Task 9) returns `completion: instrument.completion[phase]` as a plain string, not the `{baseline, debrief}` object from the raw instrument file. Do not index it again on the client.

- [ ] **Step 3: Manual verification (full baseline flow)**

With both dev servers running:

1. Open `http://localhost:5173/?week=4&mode=baseline`.
2. Enter a valid email, click Start.
3. Answer all 4 subscales (use varied answers, not all the same value), clicking Next each time.
4. On the Review screen: expected 4 rows, all reading "answered 5 of 5" in the success color.
5. Click Submit. Expected: brief "Submitting..." state, then the Confirmation screen with the baseline completion text (module number substituted in), a monospace completion code matching `AL4-B-XXXXXXXX`, and a working Copy button.
6. Check the server terminal log: expected either `[DB] Schema initialized` / `[CheckIn DB] Schema initialized` (if `DATABASE_URL` is set locally) or, if not, a 503 on submit -- in that case, set a local Postgres or the shared dev instance's `DATABASE_URL` to complete this check end-to-end.

- [ ] **Step 4: Manual verification (straightlining prompt)**

Repeat the flow, this time answering every single item (all 20 core items) with the same value (e.g., always "4"). On the Review screen, click Submit.
Expected: a browser confirm dialog reading "You answered every item the same way. Submit anyway?" appears before the request is sent. Clicking Cancel keeps you on the Review screen; clicking OK proceeds to submission.

- [ ] **Step 5: Manual verification (full debrief flow)**

Repeat with `?week=4&mode=debrief`, completing the post-experience and open-ended screens as well. Expected: the Review screen shows 6 rows (4 subscales + Post-Experience Reflection + Reflection Questions), and after submit, the confirmation screen shows the debrief completion text with a code matching `AL4-D-XXXXXXXX`.

- [ ] **Step 6: Commit**

```bash
git add client/src/CheckIn.jsx
git commit -m "feat: add check-in review, submit, and confirmation screens"
```

---

### Task 16: Privacy statement page

**Files:**
- Modify: `server/index.js`
- Test: `server/tests/checkin.privacy.test.js`

Satisfies spec acceptance criterion 8 ("The privacy page exists and the intro screen links it") and section 9's requirement for a plain-language privacy statement. `CheckIn.jsx`'s Intro screen (Task 12) already links to `/privacy` -- this task makes that link resolve to something real instead of falling through to the SPA.

- [ ] **Step 1: Write the failing test**

Create `server/tests/checkin.privacy.test.js`:

```javascript
const request = require('supertest');

function createApp() {
  delete require.cache[require.resolve('../index')];
  return require('../index');
}

describe('GET /privacy', () => {
  test('returns a plain-language privacy statement', async () => {
    const app = createApp();
    const res = await request(app).get('/privacy');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toMatch(/LDRC/);
    expect(res.text).toMatch(/course measurement/i);
    expect(res.text).toMatch(/delete/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx jest tests/checkin.privacy.test.js`
Expected: FAIL -- the SPA fallback (or a 404) serves at `/privacy` today, and its content will not match the privacy-specific assertions.

- [ ] **Step 3: Add the /privacy route**

In `server/index.js`, add this route before the SPA fallback (`app.get('*', ...)`) -- route order matters, since Express matches in registration order and the fallback would otherwise swallow this path:

```javascript
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
  Baseline Check or Debrief in the OBLD 500 check-in module, administered by LDRC.</p>

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
  <p>Your email and responses are stored securely for as long as they are
  useful for course measurement. You can ask your course developer to
  delete your data at any time -- see "How to ask for deletion" below.</p>

  <h2>How to ask for deletion</h2>
  <p>Email your course developer at any time to ask that your responses be
  deleted. Any use of your data for research beyond course measurement
  would require separate IRB-approved consent, which this page does not
  cover.</p>
</body>
</html>`);
});
```

Two things about the text above are corrections, not the original draft: the intro paragraph names LDRC explicitly (the test's own `/LDRC/` assertion required it, and the first draft of this page never mentioned it by name -- a bug in the task itself, caught when the test predictably failed for the right reason), and "How long" no longer promises automatic deletion at course end. That promise isn't backed by any code in this plan -- the retention purge job is explicitly deferred (see the deviations list at the top of this document) -- so the wording above only describes what's actually true today: data is retained, and deletion happens if a human acts on a request, not automatically.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && npx jest tests/checkin.privacy.test.js`
Expected: `Tests: 1 passed, 1 total`

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `cd server && npm test`
Expected: all suites pass.

- [ ] **Step 6: Commit**

```bash
git add server/index.js server/tests/checkin.privacy.test.js
git commit -m "feat: add plain-language /privacy statement page"
```

---

### Task 17: Full-stack smoke test and production build check

**Files:** none (verification only)

- [ ] **Step 1: Run the full server test suite one more time**

Run: `cd server && npm test`
Expected: all suites pass (32 original + all new check-in tests).

- [ ] **Step 2: Confirm the client still builds for production**

Run: `cd client && npm run build`
Expected: build succeeds with no errors (Vite will report bundle size; a warning about chunk size is fine, an error is not).

- [ ] **Step 3: Build and run the full Docker image locally (mirrors how this session verified the Sim restart)**

From the repo root:

```bash
docker build -t sim-checkin-test .
docker run -d --name sim-checkin-test -p 18090:3000 \
  -e ANTHROPIC_API_KEY=test-not-real \
  -e CHECKIN_HMAC_SECRET=local-test-secret \
  -e CHECKIN_AES_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")" \
  sim-checkin-test
```

- [ ] **Step 4: Smoke-test the containerized app**

```bash
curl -s -o /dev/null -w "GET / -> %{http_code}\n" http://127.0.0.1:18090/
curl -s -o /dev/null -w "GET /privacy -> %{http_code}\n" http://127.0.0.1:18090/privacy
curl -s -w "\nHTTP %{http_code}\n" http://127.0.0.1:18090/api/instrument/OBLD500/4/baseline
curl -s -w "\nHTTP %{http_code}\n" -X POST http://127.0.0.1:18090/api/responses -H "Content-Type: application/json" -d '{}'
```

Expected: `GET /` returns 200; `GET /privacy` returns 200; `GET /api/instrument/...` returns 200 with the AL instrument JSON; `POST /api/responses` with an empty body returns 400 (validation error, not a crash) -- and, since no `DATABASE_URL` was set for this container, it should actually return 503 before validation even runs, confirming `requireDb` still gates the route correctly.

- [ ] **Step 5: Clean up**

```bash
docker rm -f sim-checkin-test
docker rmi sim-checkin-test
```

- [ ] **Step 6: Push the branch**

```bash
git push -u origin feature/checkin-module
```

Do not open a PR or merge automatically -- hand this off for review first (see "Handoff" below).

---

## Handoff

This plan deliberately stops short of deploying to `sim-prod`. Once all 17 tasks are complete and reviewed:

1. Open a PR from `feature/checkin-module` into `main` (or merge directly, matching this repo's existing convention of mostly-direct-to-main commits -- ask Dr. Watkins which he prefers for this one, since it is a larger change than the usual commit).
2. Deploy following the exact same pattern used to restart Sim on 2026-09-13: `az acr build` a new image, `az containerapp update` to point `sim-prod` at it. This requires setting the two new secrets (`CHECKIN_HMAC_SECRET`, `CHECKIN_AES_KEY`) in Key Vault (`ldrc-cortex-kv-dev`, alongside `ldrc-sim-anthropic-api-key` and `ldrc-sim-database-url`) and wiring them into the container app the same way `DATABASE_URL` was wired in this session.
3. Before pointing real students at it: resolve spec section 15's open questions (especially identity mode), and do not ship `AL.json` as real Module 4 content -- either replace it via the migration step or leave Module 4's check-in unlaunched until migration lands.
4. Spec acceptance criterion 5 calls for testing with an actual screen reader (NVDA or VoiceOver), not just keyboard-only navigation. Nothing in this plan can perform that -- it needs a human with the assistive tech installed. Do this before the December load test, per the spec's own timeline; it does not block merging this plan's code.
