# Sim: standing handoff
Stamp: 2026-09-29 0900 PDT

Read this first when work on Sim resumes. It is the current state of record.
Update it at the end of any session that merges, deploys, or changes what a
future session needs to know to avoid re-deriving. `README.md` documents how
the app works; this file documents where things stand right now and what is
still open.

## What this is

OBLD 500 Leadership Simulation Suite: AI observation/simulation scenarios plus
a Check-In Module (Baseline/Debrief instruments) for ERAU's OBLD 500 course.
Express API proxy + React/Vite client, one Docker image, Azure Container Apps.
Live at sim.ldrcoach.com. Full architecture in `README.md`; this file assumes
you've read that.

## Current state

- `main` at commit `168e2e6` (PR #15's own merge). **Zero open PRs, zero
  branches besides `main`** as of this stamp.
- Deployed: `sim-prod` revision `sim-prod--0000014`, image
  `sim-prod:20260928141700` (built from `1c5899f`, one commit behind `main`,
  but that one commit is this file's own prose; nothing code-facing changed).
  **`main` and deployed are in sync.** Verified live: `/privacy` states the
  90-day email deletion (PR #13).
- `sim-prod` has no `MODEL` env var, so `/api/chat` uses the code default,
  `claude-sonnet-5`. ERAU IT was told Sonnet 5; if you set `MODEL`, the IT
  description changes too.
- All 9 OBLD 500 Check-In modules serve real, sourced instrument content. No
  placeholders remain.
- 195/195 server tests passing. 0 open Dependabot alerts. CI runs both the
  server test suite and a client build (`client-build` job, added 2026-09-14).
- `main` has **no branch protection configured** (`gh api
  repos/ldrcoach/sim/branches/main/protection` returns 404). CI checks show
  red/green but don't block a merge on failure. Nobody has asked for this to
  be fixed; it's just true and easy to forget.
- **Session closeout, 2026-09-29:** a doc-sync PR (#14) opened by this local
  session's history turned out redundant with #15, which a different cloud
  session had already merged more completely (including the actual deploy).
  Closed #14 rather than merging stale content over #15. Deleted every
  fully-merged branch, local and remote (`chore/dependabot-fixes`,
  `claude/funny-gates-8riq6b`, both `docs/handoff-*`, `feature/ci-client-build`,
  `fix/lf-real-instrument-content`), plus `wip/uncommitted-2026-08-01` (a
  2026-08-01 defensive snapshot of 3 now-superseded untracked files, deleted
  with explicit user confirmation after inspection). Also found and fixed
  five-plus-months-stale Cortex project-context entries that still described
  a decommissioned DigitalOcean droplet, no database, and no tests; see
  `cortex_project_context(project_id="sim")` for the corrected version.

## Where things live

Standard layout is in `README.md`. Two things worth calling out here:

- `server/checkin/instruments/*.json` is Sim's deployed copy of the 9
  instrument files. `D:\DEV\icdf\courses\obld500\instruments\` is the
  cross-repo source-of-truth copy (see below); when one changes, the other
  needs the same content change, by hand, both ways.
- Deploy is still fully manual: `az acr build --registry ldrccortexdev
  --image sim-prod:<tag> .` then `az containerapp update -n sim-prod -g
  rg-calkeepwest-dev --image ldrccortexdev.azurecr.io/sim-prod:<tag>`. No CD
  pipeline. The `az` CLI has a known cosmetic Windows Unicode/colorama crash
  on some output; if a build/deploy command appears to crash, verify with
  `az acr task list-runs --registry ldrccortexdev` / `az containerapp show`
  before assuming it failed. Don't trust a crashed CLI's exit code alone.

## Cross-repo relationship with ICDF

`D:\DEV\icdf` is a separate repo: the OBLD 500 course-content pipeline
(Canvas cartridge, training plans, the instruments folder that mirrors Sim's).
It has its own excellent, actively maintained `courses/obld500/HANDOFF.md`;
read that when anything you're doing touches course content, not just the
app. Its `courses/obld500/SESSION_REPORT_2026-09-15.md` documents an
extensive, already-thorough course-content audit (citations, quiz bank bias,
register/voice edits, the instrument reverse-scoring fixes referenced below)
done by other sessions across 2026-09-14 through 2026-09-17. That work is not
this project's to re-verify or redo: it's ICDF's domain, already reviewed
and gated by the user's own decisions throughout.

**Instrument sync discipline:** the two copies (Sim's, ICDF's) should carry
identical *content* at all times. Their JSON formatting style currently
differs (Sim: compact single-line items; ICDF: pretty-printed multi-line),
which is cosmetic and harmless, but it means a raw `diff` between the two
files will show noise even when content is identical. **Compare with parsed
JSON (`python3 -c "import json; a=json.load(open(...)); b=json.load(open(...));
print(a==b)"`), not raw diff**, or you'll misdiagnose drift that isn't there
(or miss drift that is, if you only eyeball the raw diff's shape).

**Two items ICDF's `HANDOFF.md` lists as "deferred, not part of this
release" for Sim's side, as of its 2026-09-18 stamp:** "sim app purge
scheduling" and "the IP wording for SimuLeader." Neither is specified beyond
that one line anywhere in ICDF; no ticket, no elaboration, checked via grep
across the whole `courses/obld500/` tree. **Don't guess at what these mean or
start implementing against an assumption.** Ask the user to scope them first.

## ERAU IT security review (ticket 581416)

ERAU IT Security is reviewing SimuLeader for use in OBLD 500. The user sent
their answers on or around 2026-09-24. Treat what was stated as commitments;
changing any of them means telling IT:

- Simulation/observation conversations go browser -> Sim server -> Anthropic
  API and are **not stored** by Sim (the client only calls `/api/chat`; the
  `sim_sessions`/`sim_transcripts` persistence endpoints exist but are
  unused). No student identifiers are sent to the AI.
- Check-In data is never sent to the AI. Email is AES-256-GCM encrypted,
  stored apart from answers (answers keyed by an HMAC-derived ID), and
  **deleted automatically 90 days after the course end date**
  (`courses.json`: `course_end_date` 2027-03-14 +
  `retention_days_after_end` 90, so first real purge is 2027-06-12). The
  daily `purge-expired.yml` workflow runs green; `CHECKIN_ADMIN_TOKEN` is set
  on both sides.
- Anthropic: Commercial Terms, no training on API data, inputs/outputs
  deleted within 30 days. Verified in the Console: the org default is 30-day
  retention, no ZDR. Don't describe this as "zero retention."
- Offered as an option, not enabled: switching OBLD500's `identity_mode` to
  `key` (no email stored).

Next expected step: IT's security questionnaire. Draft answers from the code,
not from memory, and keep them consistent with the list above.

**ZDR decision (2026-09-28):** stay on 30-day retention. If IT ever requires
zero retention, request ZDR for a **separate Anthropic organization** and
move Sim's key there (`ldrc-sim-anthropic-api-key` in Key Vault, then restart
`sim-prod`). Don't enable ZDR on the current org: ZDR is org-wide, it blocks
the Covered Models (Fable 5/5.1, Mythos 5/5.1) other LDRC projects use, and
the only per-workspace override goes the other direction (30-day inside a ZDR
org). Sonnet/Opus/Haiku are unaffected either way.

## Open items

1. **Branch protection on `main`.** Not configured. Not requested. Flagged
   twice now (PR #9's review, this handoff) so it doesn't need discovering a
   third time; surface it if the topic of merge safety comes up again.
2. **"Sim app purge scheduling" and "IP wording for SimuLeader."** Carried
   over from ICDF's `HANDOFF.md`. Needs scoping with the user; don't act on
   a guess.
3. **EM.json's content is IRI-derived** (Davis's Interpersonal Reactivity
   Index, 1983), disclosed via `psychometric_note`, and the user explicitly
   authorized shipping it as-is ("consider the licensing settled"). That's a
   decision, not a cleared license. Revisit from
   `D:\DEV\icdf\courses\obld500\instruments\README.md`'s "Licensing
   decisions" section if this is ever challenged.
4. **Multi-course wiring exists in the code** (`courses.json`, identity
   modes, the `?course=` param) but only `OBLD500` is actually configured.
   Not actionable until another course asks for it.

## Lessons worth not re-learning

- **Verify a "merge and deploy" instruction actually needs a deploy.** Check
  the Dockerfile's `COPY` list against the PR's changed files first. A
  CI-config-only or docs-only change has zero effect on the running image,
  so running a pointless rebuild-and-redeploy is busywork, not thoroughness.
  Skip it, but say clearly why.
- **A caveat flagged once is not "communicated."** State it again every time
  a summary could be read as "everything is done": see
  `feedback_surface_caveats_persistently` in this session's memory. This
  handoff document exists partly because of that lesson: it's meant to be
  re-read and kept current, not written once and trusted forever.
- **Don't trust a handoff's "tests pass" claim.** Run the suite yourself,
  every time, even from a well-reasoned prior session. This has caught real
  discrepancies before (a prior handoff claimed 179 passing; the real count
  was 175 with 4 failures from a legitimate content change the claim didn't
  account for).
- **ICDF is sometimes another agent's active working tree.** Before touching
  anything there, check `git status`/branch; don't assume it's idle just
  because this session isn't the one that last touched it. When committing
  there, stage exact file paths, never a broad `git add -A`, since unrelated
  work-in-progress from other sessions routinely sits uncommitted alongside
  whatever you're doing.
- **Public-facing text must match the code.** The privacy statement once
  said data was kept "as long as useful" while the code purged emails at 90
  days. Before anything goes to IT, students, or ERAU, check each claim
  against the code or live config, and fix whichever side is wrong.
- **JSON-diff instrument files by content, not raw text**, per the sync
  discipline above: a raw diff between Sim's and ICDF's copies will look
  like total rewrite even when nothing substantive changed.
- **Before opening a doc-sync PR (like this file's own updates), check
  `gh pr list` and read the live file on `main` first**, not just this
  session's own last-known state. PR #14 and #15 both tried to update this
  exact file the same week; #15, from a different session, got there first
  and more completely, making #14 pure rework. Checking first would have
  caught that before spending the effort.

## Standing rules for this project

- Push and open a PR for every Sim branch when done; don't ask which option
  each time, this is the standing preference.
- Get explicit user authorization before every merge and every deploy, every
  time. This has been consistent without exception; a prior approval does
  not extend to a later, similar-looking action.
- No em dashes, no double hyphens in anything a student or Heart (ICDF's
  instructional designer) reads. Shared house style with ICDF, enforced
  there by a build-failing check, not yet enforced by anything in Sim.
- Get independent review before merging, even for small, "obvious" changes
  (a one-line CI permissions fix got the same review cycle as a full content
  migration this session). Proportionate effort, not skipped.
