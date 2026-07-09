# Intelligent, Self-Improving PT Programme Generation

Source-of-truth doc for the multi-session project that makes Cerebro's PT programme
generator (a) honor what Pedro types, (b) actually read the client's documents, and
(c) improve itself every time Pedro edits a programme.

Companion files:
- Approved plan: `~/.claude/plans/ok-we-need-to-squishy-honey.md`
- Auto-memory: `project_pt_intelligent_generation.md`
- Handoff pointer: `cerebro-site/HANDOFF.md`

IMPORTANT house rules (from the learning log):
- No em dashes in any `.md` file. A pre-commit hook rejects them. Use hyphens.
- Edge functions must be deployed separately from `git push`. Committed source newer
  than deployed = "deploy drift". Never tell Pedro a pipeline change is live until it
  is deployed AND verified. Use the `pt-pipeline-deploy-verify` skill.
- Supabase project ref: `otcnrkfvgyvwolironoz`. Repo git branch: `main` (project commits
  directly to main; Pedro has durably authorized commit + push after every change).
- Large PT/client `.tsx` files carry pre-existing `react-hooks/set-state-in-effect`
  lint errors. Rely on `npx tsc --noEmit` + `npm run build`, not a clean eslint.

---

## 1. The problem (root cause, traced)

Pedro asked for "a bodyweight workout, for home, no weights, focusing on hips,
6 exercises" and got the same generic 5-phase Big-5-barbell programme every client gets.
He also uploaded documents that the AI never used. The website generation runs on
Supabase EDGE FUNCTIONS (not the local `pt-*` skills, which are a Claude Code mirror).
Root cause, in four parts:

1. The coach's request (`intake_text`) reaches only 2 of 6 agents as loose notes,
   is distilled into rigid JSON with no slot for equipment/location/focus/count, then
   is dropped. There are no structured constraint fields at all.
2. `programme-synthesis-agent` builds every phase from hardcoded templates and RETURNS
   before its own LLM prompt runs (the prompt is dead code). It force-loads the Big 5 by
   hardcoded UUID into every hypertrophy/strength day.
3. `programme-validation-agent` hard-fails anything that is not 5 phases / 3 Foundation
   days / all-Big-5. So a bespoke bodyweight session is rejected by design.
4. Documents were a dead-end: `content_text` was only populated by the wizard intake
   step; the client-profile uploader stored a file path and never extracted text
   (`parse-client-document` is dead code); docs that were read used an unordered
   `.limit(5)` into only 2 agents.

## 2. What Pedro wants (the vision)

- ONE unified entry point: pick a client, then a step auto-pulls and DISPLAYS every
  document that client already has (M&L profile, movement assessment, anything uploaded)
  so Pedro can read them, then a single text box where he says what he wants. The AI
  decides journey vs one-off; if it cannot tell, it asks clarifying questions first;
  Pedro confirms; it builds.
- Read the docs like a physio and drive exercise selection from that understanding.
  Honor typed constraints for Foundation. Keep squat/bench/pull-up/deadlift/OHP spread
  across the week while choosing ACCESSORIES from the client's goals/conditions AND what
  they did the prior phase. Show sustainable progressive overload (total kg per week).
- When there is no assessment doc and Pedro types a request (states equipment access,
  says "client needs knee strength"), the AI asks clarifying questions, optionally does
  internet research, then builds something fully bespoke (his example: a workout plus
  guidelines for friends who work on a boat).
- Do NOT break what works. Existing saved programmes and the 5-phase default must keep
  working. He is open to a chat-style interface.

## 3. Architecture map

Generation pipeline (all under `cerebro-site/supabase/functions/`):
`pt-programme-orchestrator` calls, in order:
`client-analysis-agent` -> `movement-analysis-agent` -> `exercise-intelligence-agent`
-> `methodology-plan-agent` -> `programme-synthesis-agent` (per phase)
-> `programme-validation-agent`.

Orchestrator wall-clock: Supabase edge workers die at ~150s, so the orchestrator splits
into self-invoking stages (STAGE_ANALYZE / STAGE_EXERCISE / STAGE_SYNTHESIZE) and stashes
hand-off state in `coaching_reasoning._scratch` (`loadScratch`/`saveScratch`). Every agent
has a deterministic fallback. `callAgent` races each fetch against a timeout.

Wizard UI: `app/dashboard/pt/programmes/new/PTProgrammeWizard.tsx`. On generate it invokes
`pt-programme-orchestrator` with `{ client_id, phase_weeks, days_per_week, intake_text }`.
`intake_text` = the free-form "Brain dump" textarea. Wizard seeds the fixed 5-phase skeleton
`DEFAULT_PROGRAMME_PHASES` from `utils/pt/programme.ts`. Steps: 1 Generate, 2 Review,
3 Edit, 4 Create. Draft autosaves to `pt_program_generation_runs.programme_draft`.

Reusable primitives (do NOT rebuild):
- `build-workout-from-text/index.ts`: freeform text -> structured, library-linked phase
  (parse -> match `pt_exercises` -> create missing -> assemble in canonical section order).
  No UI caller today. This is the one-off builder for Pillar B and the BESPOKE assembler.
- `rebuild-programme-phase/index.ts`: a working chat agent (start/message/generate) with
  Anthropic `web_search`, literature RAG, per-client brain RAG, run/step persistence in
  `pt_program_generation_runs` + `pt_program_generation_steps`, and a deterministic fallback.
  This is the model for Pillar B's conversational entry point. Scoped to one phase today.
- `pt-programming-agent/index.ts`: another tool-use agent (revision path).
- Client brain: tables `pt_client_brain`, `pt_client_exercise_doc`,
  `pt_client_nutrition_doc`, `pt_client_brain_reports`; RAG chunks in
  `pt_client_brain_chunks` (doc_types master/nutrition/exercise/lifestyle) via
  `match_client_brain_chunks`. Write path = `update-client-brain/index.ts`; re-embed =
  `embed-client-brain/index.ts`; periodic review = `weekly-client-brain-review/index.ts`.
- Doc ingest: `ingest-client-intake/index.ts` takes
  `{ client_id, files:[{name, document_type, content_text}], notes_text }`, inserts into
  `pt_client_documents`, and distributes into the 4 brain docs via an LLM. PDF text
  extraction route: `app/api/pt/parse-pdf/route.ts` (POST FormData `file` -> `{ text }`).
- Literature RAG: `retrieve-knowledge-context` + `pt_knowledge_documents` /
  `pt_knowledge_chunks` (global, admin-curated). Used by the methodology step only.
- Change capture: `pt_events` (`event_type` + `metadata` jsonb) already logs
  `programme_exercise_swapped|removed|sets_changed|position_changed`, `workout_logged`,
  `pt_session_completed`. Overview (`app/dashboard/pt/overview/page.tsx`) reads it.
- Coaching reviews: `generate-pt-review/index.ts` + `PTCoachingReview` type (weekly/monthly).
- Progressive overload: weekly-tonnage tool (migrations `20260707*`, `20260708*`),
  plus `recalculate-percentage-loads` and the `pt-prescribe-workout-weights` logic.
  1RM lives in `pt_client_1rm_*` or is derivable from `pt_set_logs`.
- Structure helpers: `utils/pt/programme.ts` (`DEFAULT_PROGRAMME_PHASES`,
  `CANONICAL_SECTION_ORDER` Warm Up -> Workout -> MetCon -> Stretches, phase helpers).

Pedro's current programming philosophy (learning-log Entry 070): he prioritizes weekly
set volume and split structure (2-3 days full body, 4 days upper/lower, 5 days
upper/lower/full body) over rigid Big-5-every-day. Keep this in mind when tuning STANDARD
mode. Entry 072: any generated insert into `pt_exercises` must mirror the `lower(name)`
unique index (per-exercise lookup/insert/retry, non-fatal on failure). Equipment lists
Pedro gives are strict.

---

## 4. Plan: three pillars, build A -> B -> C, each flag-gated to Pedro first

Core idea threaded through A: build ONE `coach_directive` (freeform `intake_text` +
structured `constraints`) and ONE `physio_brief` (from the movement agent) and pass both
to every agent that currently flies blind. Deterministic engine stays as the fallback floor.

### PILLAR A - Smart generation

**A1 - Unlock client documents everywhere. STATUS: DONE (code, commit c4f1995).**
- `app/dashboard/pt/clients/[id]/PTClientDetail.tsx` `handleUpload`: after storage upload,
  extract text (PDF -> `/api/pt/parse-pdf`, `.txt/.md` read directly) and call
  `ingest-client-intake` with `{ client_id, files:[{name, document_type: uploadDocType,
  content_text}] }`. Added `uploadDocType` state + a selector in the "Client profile
  document" section. Non-PDF binary (.doc/.docx) is stored but not extracted (honest
  message). This part is LIVE on push (Vercel), no deploy needed.
- `client-analysis-agent/index.ts` and `movement-analysis-agent/index.ts`: doc query is now
  `.select('document_type, title, content_text, created_at').eq(...).order('created_at',
  {ascending:false}).limit(12)`, then a stable sort floats `movement_assessment` first
  (`rankDoc`). Both call sites use the sorted `documents` const.
- `movement-analysis-agent/index.ts`: SYSTEM_PROMPT now emits a top-level `physio_brief`
  string; handler returns `physio_brief` (prefers model output, else `buildPhysioBrief`
  deterministic summary of the mind map). NOTE: these two edge functions are NOT yet
  deployed (drift). Deploy in task #8 after A2.

**A2 - Thread coach_directive + constraints through the pipeline. STATUS: NEXT.**
- `pt-programme-orchestrator/index.ts` `OrchestratorBody` (around lines 27-32): add optional
  `constraints { equipment?: 'full_gym'|'home_minimal'|'bodyweight'|'bands'|'travel';
  location?: string; focus_areas?: string[]; exercises_per_day?: number;
  session_length_min?: number; avoid?: string[] }` and `intent?: 'journey'|'one_off'`.
  All optional: absent = today's behavior exactly.
- In `stageAnalyze`: build `coach_directive` (= `intake_text` + a rendered summary of
  `constraints`). After calling `movement-analysis-agent`, capture its new `physio_brief`.
  Stash both `coach_directive` and `physio_brief` in `_scratch` (via `saveScratch`).
- Thread into the downstream `callAgent` bodies that currently get none of it:
  `exercise-intelligence-agent` (today gets only `muscle_mind_map`),
  `methodology-plan-agent`, and each `programme-synthesis-agent` phase call. Add the fields
  to each agent's request body type and inject them into each agent's user prompt.
- Wizard `PTProgrammeWizard.tsx` step 1: add structured constraint inputs (equipment select,
  location text, focus-area chips, exercises/day stepper) next to the days-per-week control,
  and include `constraints` in the orchestrator invoke body. (Can also be deferred to
  Pillar B, which replaces this UI; minimum for A2 is the backend plumbing.)

**A3 - Un-hardcode programme-synthesis-agent safely. STATUS: pending. THE core fix.**
- In `programme-synthesis-agent/index.ts`, `buildDeterministicPhase(...)` currently runs and
  returns before the LLM (around lines 178-179). INVERT: try the LLM first, gate
  `buildDeterministicPhase` as the fallback (match the pattern in `exercise-intelligence-agent`
  and `methodology-plan-agent`).
- STANDARD mode (no bespoke constraints): keep deterministic Big-5 anchoring
  (`scheduleBig5`/`pickBig5`, hardcoded UUIDs `BIG5_ORDERED_IDS` stay). REPLACE the regex
  accessory picker (`pickAccessories`) with an LLM accessory selection informed by
  `coach_directive` + `physio_brief` + `exercise_master_list` + `prior_phase_summary`.
  Merge = warmups + deterministic Big-5 anchors + LLM accessories.
- BESPOKE mode (`equipment` in {bodyweight, home_minimal, bands, travel} or `intent==='one_off'`):
  skip Big-5; LLM builds the whole day honoring `coach_directive`, lifting the resolve/create
  helpers from `build-workout-from-text` (per-exercise lookup/insert/retry, mirror `lower(name)`).
- Keep every `enrichPhase` guardrail (real `exercise_id`, canonical section order,
  server-attached `video_url`/`cues`). Fix `inferGymAccess` (around lines 826-842) to read
  structured `constraints.equipment` (fallback to the legacy substring scan for old runs).

**A4 - Phase linkage + progressive overload. STATUS: pending.**
- Orchestrator `stageSynthesize`: add a `priorPhaseSummary` accumulator (after phase i,
  capture `{ phase_type, chosen_accessory_names, day_focuses }`) and pass as
  `prior_phase_summary` into phase i+1's synthesis call. So Hypertrophy builds on Foundation
  and Strength on Hypertrophy.
- Add a deterministic `prescribeLoads` sub-step (reuse `recalculate-percentage-loads` /
  `pt-prescribe-workout-weights` logic + the weekly-tonnage tool) to fill real kg and surface
  total kg per week per phase/block. Skip gracefully when no 1RM.

**A5 - Bespoke-aware methodology + validator. STATUS: pending.**
- `methodology-plan-agent/index.ts`: warmup/main/superset counts (`warmup_count=4`,
  `main_count=6`, `superset_count=3`) become defaults flexible to `constraints.exercises_per_day`;
  Big-5 / 5-phase enforcement conditional on mode.
- `programme-validation-agent/index.ts`: add a `mode`. STANDARD keeps all current hard rules.
  BESPOKE downgrades Big-5 / 5-phase / 3-day-Foundation from hard failures to soft findings,
  while still hard-enforcing real `exercise_id` + canonical section order + valid `week_blocks`.
  Orchestrator sets the mode from the directive.

**Task #8 - Deploy + verify Pillar A edge functions.** After A2, deploy the changed edge
functions to ref `otcnrkfvgyvwolironoz`: client-analysis-agent, movement-analysis-agent,
pt-programme-orchestrator, exercise-intelligence-agent, methodology-plan-agent,
programme-synthesis-agent, programme-validation-agent. Then run `pt-pipeline-deploy-verify`
and smoke-test one full generation to `needs_review`.

### PILLAR B - Unified conversational entry point (after A proven)

Replace the wizard-vs-chat fork with ONE screen (augment `app/dashboard/pt/programmes/new/`):
client select -> auto-load and DISPLAY all the client's documents (pt_client_documents,
the M&L profile PDFs `document_type='profile'` / `pt_clients.document_url`, brain docs),
each readable inline -> single text box + optional constraint chips. An intent+readiness
agent (model on `rebuild-programme-phase` start/message/generate) classifies journey vs
one-off, asks one clarifying question at a time (persist in `pt_program_generation_runs`/
`_steps`, `awaiting_input` status the wizard already polls), then routes: journey ->
`pt-programme-orchestrator` (Pillar A) with `intent:'journey'` + constraints; one_off ->
`build-workout-from-text` with directive + client context (optional `web_search`, cited).
Both land in `programme_draft` -> existing Step 2-4 review/edit/create. Feature-flag to
Pedro's account first (the PEDRO_EMAILS allow-list pattern already used in the repo).

### PILLAR C - Self-improving learning loop (after B)

- C1 Capture: builder edits already emit `pt_events` (programme_exercise_*). Add a
  `session_deviation` event when a logged `pt_set_logs` value diverges from the prescribed
  exercise/sets/weight. Extend `metadata` with before/after; no new table.
- C2 Ask why: on `app/dashboard/pt/overview/page.tsx` (and/or the client-detail coaching-
  review panel), add a "Recent changes - tell me why" card listing recent un-annotated
  change events and collecting a short reason. Store reason to `pt_events.metadata.reason`
  (+ `reason_at`). Reuse `generate-pt-review` / `PTCoachingReview`.
- C3 Distill: new edge function `distill-coaching-learnings` (model on
  `weekly-client-brain-review`) reads recent change+reason events and writes
  (a) per-client learnings via `update-client-brain` into the exercise/lifestyle brain docs,
  then `embed-client-brain` re-chunks; (b) per-coach methodology as a new
  `pt_knowledge_documents` row `source='pedro_methodology'` so `retrieve-knowledge-context`
  surfaces it into the methodology + synthesis steps for every client.
- C4 Feed back: extend synthesis / exercise-intelligence to also consult per-client learnings
  and the `pedro_methodology` knowledge. Run C3 on a schedule + after change batches.

---

## 5. Status board (mirror of the task list)

- [x] A1 Unlock client documents (commit c4f1995; frontend live; agents need deploy)
- [ ] A2 Thread coach_directive + constraints through pipeline  <- NEXT
- [ ] A3 Un-hardcode programme-synthesis-agent
- [ ] A4 Phase linkage + progressive overload
- [ ] A5 Bespoke-aware methodology + validator
- [ ] #8 Deploy + verify Pillar A edge functions (blocked by A2, A3, A5)
- [ ] B Unified conversational entry point (blocked by A3)
- [ ] C Self-improving learning loop

## 6. Verification (end to end)

1. Docs unlock: upload a movement-assessment PDF on the profile page, then query
   `pt_client_documents` (Supabase MCP) and confirm `content_text` is populated; confirm the
   analysis prompts include it.
2. Bespoke honoring: generate with `constraints {equipment:'bodyweight', location:'home',
   focus_areas:['hip'], exercises_per_day:6}` and confirm Foundation is bodyweight, hip-focused,
   ~6 exercises, no barbells, and passes the validator in BESPOKE mode.
3. Standard still works: generate a full-gym client with an assessment and confirm 5 phases,
   Big-5 spread intact, accessories vary and reflect the physio brief, Phase 2 builds on
   Phase 1, total kg/week present.
4. No regression: generate with no constraints and the LLM flag off; output matches today's
   deterministic result.
5. Learning loop: swap an exercise in the builder, confirm a `programme_exercise_swapped`
   event, the overview "tell me why" card lists it, enter a reason, confirm
   `distill-coaching-learnings` writes a per-client learning + a `pedro_methodology` note,
   and a later generation surfaces it.
6. Always run `pt-pipeline-deploy-verify` after deploys; drive one full generation in the
   browser to confirm the run reaches `needs_review`; keep the local `pt-*` skills in sync.
