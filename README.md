# OBLD 500 Leadership Simulation Suite

AI-powered observation and practice simulations for OBLD 500 (Leadership in Organizations) at Embry-Riddle Aeronautical University.

## What This Is

54 AI scenarios across 9 weeks:
- **27 Observations** (Phase 3): AI-generated demonstration conversations with key moment annotations and perspective shifts
- **27 Simulations** (Phase 4): Interactive conversations with AI characters who respond to student behavior, followed by automated 6-dimension rubric scoring

81 unique characters. Zero name collisions. 3 scenarios per week per activity type.

## Architecture

```
sim-ldrcoach/
  client/           React frontend (Vite build)
    src/
      App.jsx        Unified landing page + router
      suites/        4 suite components (27 simulations + 27 observations)
  server/           Express API proxy + persistence
    index.js         Proxies /api/chat to Anthropic, persistence endpoints, rate limiting
  nginx/            Reverse proxy config for sim.ldrcoach.com
  setup.sh          Droplet provisioning script
```

## Deployment (Azure Container Apps)

Sim runs as a single Docker image (multi-stage `Dockerfile`: builds the Vite
client, then serves it as static files from the Express server) on Azure
Container Apps, Consumption plan.

- **Apps:** `sim-dev` / `sim-staging` / `sim-prod` in resource group
  `rg-calkeepwest-dev`, on the shared `ldrc-cortex-dev-env` managed
  environment.
- **Custom domain:** `sim.ldrcoach.com` -> `sim-prod`, via an Azure managed
  certificate (auto-renewing).
- **Secrets:** pulled from Key Vault `ldrc-cortex-kv-dev` -- never set as
  plain env vars. Currently: `ANTHROPIC_API_KEY`, `DATABASE_URL`, and (for
  the Check-In Module) `CHECKIN_HMAC_SECRET`/`CHECKIN_AES_KEY`
  (`ldrc-sim-checkin-hmac-secret`/`ldrc-sim-checkin-aes-key` in Key Vault)
  plus `CHECKIN_ADMIN_TOKEN` (`ldrc-sim-checkin-admin-token` in Key Vault,
  deployed since the admin API shipped).

### Deploying a new build

```bash
# Build and push the image
az acr build --registry ldrccortexdev --image sim-prod:$(date +%Y%m%d%H%M%S) .

# Point the container app at the new tag and (re)start it
az containerapp update -n sim-prod -g rg-calkeepwest-dev \
  --image ldrccortexdev.azurecr.io/sim-prod:<tag>
az containerapp start -n sim-prod -g rg-calkeepwest-dev
```

There is no CD pipeline yet -- `.github/workflows/ci.yml` only runs the Jest
suite on push/PR. Deploys are manual until that's added.

`nginx/` and `setup.sh` are the old DigitalOcean droplet path and are no
longer used; kept only for reference.

### Verify

Visit https://sim.ldrcoach.com

## Local Development

```bash
# Terminal 1: Start server
cd server
cp ../.env.example .env
# Edit .env with your API key
npm install
npm run dev

# Terminal 2: Start client (auto-proxies /api to server)
cd client
npm install
npm run dev
# Open http://localhost:5173
```

## Updating Scenarios

All scenario data (character profiles, behavior rules, rubric dimensions) is in the suite JSX files under `client/src/suites/`. Edit the SCENARIOS or OBS objects, then rebuild:

```bash
cd /opt/obld500-sim/client
npm run build
# No server restart needed (static files)
```

## Security

- **Rate limiting** via `express-rate-limit` in the server:
  - POST `/api/chat`: 20 requests / 15 min
  - General routes: 100 requests / 15 min

## Testing

- **Framework:** Jest + supertest (194 tests)
- **Run:** `cd server && npm test`
- **Mocking:** Tests mock the Anthropic API client and `pg` pool. No live services required.

## CI/CD

- **GitHub Actions:**
  - `.github/workflows/ci.yml` runs the server Jest tests on push/PR to `main`.
  - `.github/workflows/purge-expired.yml` calls the Check-In Module's
    retention purge daily via cron (also supports manual `workflow_dispatch`
    runs) -- see the Check-In Module section above.

## Persistence (PostgreSQL)

Session data is optionally stored in PostgreSQL. Requires `DATABASE_URL` env var. If not set, the server returns 503 for persistence endpoints -- existing `/api/chat` still works without a database.

**Tables:**
- `sim_sessions` -- session metadata (student, scenario, timestamps)
- `sim_scores` -- 6-dimension rubric scores per session
- `sim_transcripts` -- full conversation transcripts

**Endpoints:**
- `POST /api/sessions` -- create a new session
- `POST /api/sessions/:id/scores` -- save rubric scores
- `POST /api/sessions/:id/transcript` -- save conversation transcript
- `GET /api/students/:id/history` -- retrieve student session history

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
only check-in's own routes degrade, not the whole app). All 9 OBLD 500
modules (`SR`, `LF`, `CT`, `AL`, `EM`, `LC`, `MN`, `CS`, `SL`) have real
content, migrated from the original 18 Google Forms.

**Endpoints:**
- `GET /api/instrument/:course/:module/:phase` -- public instrument view (no reverse-scoring flags)
- `POST /api/responses` -- submit a Baseline or Debrief response, returns a completion code

**Built as of the admin/retention follow-up plan**
(`docs/superpowers/plans/2026-09-13-checkin-admin.md`): the admin API,
`courses.json` (per-course identity mode / retention config), the
automatic retention purge job, and the "then and now" comparison panel on
the Debrief confirmation screen.

**Admin endpoints** (all require an `X-Admin-Token` header matching
`CHECKIN_ADMIN_TOKEN`):
- `GET /api/admin/verify?code=` -- check whether a completion code is real
- `GET /api/admin/summary?course=` -- response counts by module/phase, straightlining counts, last submission time
- `GET /api/admin/export?course=&format=json|csv&shape=long|paired` -- long: one row per item; paired: one row per participant per module per subscale, with baseline/debrief means and deltas
- `POST /api/admin/instruments/reload` -- re-read the instrument directory without redeploying
- `DELETE /api/admin/participant?participant_id=` -- full erasure (responses and identity) for a right-to-erasure request
- `POST /api/admin/purge-expired` -- the automatic retention job's actual logic (idempotent, safe to call repeatedly); scheduled daily by `.github/workflows/purge-expired.yml` (see below)

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

## API Costs

Each simulation conversation costs approximately $0.02-0.05 in API calls. Observation generation costs ~$0.03 per generation. For a class of 25 students completing all scenarios once: ~$30-50 total for the semester.

## Canvas Integration

The Practice tab in each training plan links to this suite. Students:
1. Click "Launch AI Observation" or "Launch AI Simulation" (opens sim.ldrcoach.com)
2. Complete the AI activity (formative, ungraded)
3. Return to Canvas and submit their written reflection (summative, graded)

The AI rubric scoring is formative feedback for learning. The Canvas assignment is the graded artifact.

---
OBLD 500: Leadership in Organizations | Dr. Daryl Watkins | Embry-Riddle Aeronautical University
