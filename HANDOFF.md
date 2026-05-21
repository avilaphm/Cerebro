# Handoff

## Last updated
2026-05-21 by Codex - programme PDF upload + error display fix

## Last commit
`8769832` - Fix programme PDF upload errors

## YOU ARE HERE (read this first, 30 seconds)

The PT programme creation pipeline is structurally wired end-to-end, but live AI generation is blocked when Anthropic credits are exhausted. On 2026-05-21 Codex fixed the wizard getting stuck on Step 1 "Working..." by adding UI labels for the new movement/exercise intelligence steps, shrinking the exercise-intelligence prompt, restoring `exercise-intelligence-agent` to `verify_jwt: false`, and adding hard Promise.race timeouts around nested Edge Function calls in `pt-programme-orchestrator`. A follow-up fix made `/api/pt/parse-pdf` Node-only with dynamic `pdf-parse` import and made Step 1 display real PDF / Edge Function errors instead of `Unexpected token '<'` or generic non-2xx messages.

Live verification notes:
- Pre-fix runs were stuck at `EXERCISE_INTELLIGENCE` because nested function calls could hang without recording a step row.
- `exercise-intelligence-agent` briefly redeployed with `verify_jwt: true`; it was redeployed with `--no-verify-jwt`.
- `pt-programme-orchestrator` is deployed as version 8 with the hard timeout patch.
- Old stale `running` rows were marked `failed` with the reason "Stale pre-fix run marked failed after orchestrator timeout/auth fix. Start a new generation."
- Final smoke run `65b094a7-5212-4150-81f8-9d665fd5a2dd` failed cleanly at `CLIENT_ANALYSIS` because Anthropic returned: "Your credit balance is too low to access the Anthropic API." Once credits are topped up, rerun generation from `/dashboard/pt/programmes/new`.
- Production `/api/pt/parse-pdf` was returning an HTML 500 page before commit `8769832`; the route now avoids top-level `pdf-parse` import and the client handles non-JSON responses safely.

The intended coach journey remains client-first: create/select the client, upload intake and movement assessment documents, add coach brain dump/voice notes, save to the client brain, then generate the programme from the combined client brain plus knowledge base.

**Nutrition UX overhaul shipped (commit `114252b`).** `NutritionTab.tsx` now has full drag-and-drop between meal sections (@dnd-kit, 200ms touch hold), a tap-to-edit sheet for macros + weight (weight change scales all macros proportionally), and estimated weight display per food card. `log-nutrition-batch` uses weight-first estimation and has a serving-size calibration guide baked in. This fixes the "60g protein for one steak slice" class of errors.

**Your next chapter is refinement and UX, not new architecture.** Scroll to "Next on the list: refine and improve" (about halfway down this file) for the 16 prioritised tasks grouped by Rules / UX / Improvements. Pick by impact, not by order - they are independent.

If you are an AI agent (Codex, Claude, or otherwise) picking this up cold, read the FOR THE NEXT AGENT section directly below this. It tells you what files to read first, what gotchas to avoid, and what the test clients are.

If you have access to `~/.claude/projects/.../memory/` (Claude only), the memory entry `project_pt_programming_overhaul_vision.md` mirrors the load-bearing facts here. The plan file `~/.claude/plans/we-need-to-run-drifting-waffle.md` has the architecture diagrams + Session 1/2/3 progress narratives. Codex cannot see those; everything you need is in this file and the git repo.

---

## FOR THE NEXT AGENT PICKING THIS UP

The programme creation pipeline is end-to-end working and producing correct programmes. Architecture: intake -> distribute to 4 brain docs -> embed for RAG -> orchestrator -> 4 agents -> validated programme draft with videos, Big 5 enforcement, evidence-based mesocycle progression, and 3/4/5 days-per-week split selection. The structure is solid. The next chapter is **refinement and UX** - making the coach-facing experience match the quality of the data underneath.

### Last completed task

Movement analysis + exercise intelligence pipeline integration (2026-05-21 by Claude Sonnet 4.6).

Two new Edge Functions deployed and wired into the orchestrator pipeline as Steps 2 and 3:

**`movement-analysis-agent` (v1, verify_jwt: false):**
- Reads pt_client_exercise_doc (injury_history, limitations, movement_assessment_summary), pt_client_brain, pt_clients, pt_client_documents in parallel
- Single Claude sonnet-4-6 call with JSON retry, physiotherapy-grade muscle mind map output
- Classifies each affected muscle as WEAK or TIGHT with root cause analysis
- Persists muscle_mind_map to pt_client_exercise_doc.movement_assessment_summary for future sessions
- Non-fatal: if it fails, orchestrator continues with empty mind map

**`exercise-intelligence-agent` (v1, verify_jwt: false):**
- Loads compact exercise library from pt_exercises (id, name, muscles, equipment)
- For each primary issue muscle: generates 10 exercises that address the specific problem
- Difficulty scale 1-5 enforced: difficulty 4-5 blocked from Foundation weeks 1-4
- Tags double-duty exercises (work multiple target muscles), builds staples document per phase
- Fuzzy-matches exercises to library exercise_ids
- Non-fatal: if it fails, orchestrator continues with empty exercise_master_list

**`pt-programme-orchestrator` updated to v6:**
- STEP_NAMES now: CLIENT_ANALYSIS, MOVEMENT_ANALYSIS, EXERCISE_INTELLIGENCE, METHODOLOGY_PLAN, VALIDATION
- Steps 2 and 3 are non-fatal (pipeline continues on failure with empty fallbacks)
- Passes exercise_master_list to every programme-synthesis-agent call
- coaching_reasoning now includes: muscle_mind_map, exercise_master_list, staples_by_phase

**`programme-synthesis-agent` updated to v11:**
- Accepts exercise_master_list parameter
- Builds priority set of exercise_ids from the master list (difficulty 2-4 only)
- pickAccessories() and pickFoundationMain() prefer priority exercises over generic regex picks

**Skill chain also created in `~/.claude/skills/`:**
- `pt-movement-analysis`, `pt-exercise-intelligence`, `pt-programme-builder`, `pt-programme-validator`
- Each ends with "immediately invoke: [next skill]" - the chain self-advances
- These are for local Claude Code use, separate from the live Edge Function pipeline

**Previous session:** Bug fix - wizard stuck on Step 1 due to client-analysis-agent max_tokens: 2000. Bumped to 4096 + JSON retry. Commit 8dea13f.

**Previous session task:** Programming wizard UX overhaul (2026-05-21 by Claude Sonnet 4.6). Commit `552d8ce`.
- Step 1: PDF upload support via `/api/pt/parse-pdf`. One upload button + type selector replacing 4 separate buttons. Three scattered Generate buttons consolidated into one.
- Step 2: Foundation 7 weeks, Hypertrophy 12 weeks, Strength 12 weeks in DEFAULT_PROGRAMME_PHASES.
- Step 3: All inputs in exercise cards now have draggable=false + onMouseDown stopPropagation.
- Client portal: "coming soon" holding message added.
- Time machine tag: `programming-wizard-pre-refactor`

Nutrition UX overhaul (2026-05-21 by Claude Sonnet 4.6): drag-and-drop meal slots, macro edit sheet, weight display, accuracy prompt fix. Commit `114252b`.

"Import exercises" button added to Exercise Library header. Coach uploads a .txt/.csv/.md file (or pastes text). The `import-exercises` Edge Function runs a 2-step Claude pipeline: (1) extract all exercise names, (2) deduplicate against existing library, (3) fetch full details (muscles, equipment, video_url, cues, setup_cues, tags) in batches of 50 and insert. Handles documents up to ~120K chars. Modal shows progress and results (X added / Y skipped). Deployed and pushed (commit `5816079`).

---

Task #16 (2026-05-21 by Claude Opus 4.7) - Hardwired Helms-style mesocycle + 3/4/5 days/week selector.

The previous canonical block scheme for Hypertrophy and Strength (linear set climb across 4 blocks of 3 weeks, no deload) was replaced with the evidence-based mesocycle model from Eric Helms' Muscle & Strength Training Pyramid 2nd edition: 3 build weeks + 1 deload per 4-week meso. %1RM is now treated as a load floor/ceiling within the productive zone; RPE drives day-to-day load.

Canonical 12-week hypertrophy = 12 one-week blocks across 3 mesos:

| Week | Block | Sets | %1RM |
|---|---|---|---|
| 1 | M1 build 1 | 3 | 65% |
| 2 | M1 build 2 | 4 | 70% |
| 3 | M1 peak | 4 | 75% |
| 4 | M1 deload | 2 | 60% |
| 5 | M2 build 1 | 4 | 67.5% |
| 6 | M2 build 2 | 4 | 72.5% |
| 7 | M2 peak | 5 | 77.5% |
| 8 | M2 deload | 2 | 62.5% |
| 9 | M3 build 1 | 4 | 70% |
| 10 | M3 build 2 | 5 | 75% |
| 11 | M3 peak | 5 | 80% |
| 12 | M3 deload | 3 | 65% |

Strength uses the same shape, 77-92% peak zone. Foundation unchanged (no deload). For non-canonical week counts, the scaler emits full 4-week mesos until close to target, then a partial final meso (build + deload, or build + build + deload).

Days-per-week selector added to the wizard Step 1 (3 / 4 / 5). Big 5 auto-distributes:
- 3 days: full body x3, all 5 Big 5 each day.
- 4 days: Upper/Lower split. Squat + Deadlift on Lower A and Lower B. Bench + OHP + Pull-up on Upper A and Upper B. Each Big 5 trained 2x/week.
- 5 days: Lower A / Push / Pull / Lower B / Upper. Each Big 5 still 2x/week. Day titles: "Day 1 - Lower A (Hypertrophy)", "Day 2 - Push (Hypertrophy)", etc.

Foundation always stays at 3 full-body days regardless of selection.

Validator alias matcher: `pt_exercises` library uses canonical exercise names ("Back Squat", "Conventional Deadlift", "Barbell Bench Press", "Overhead Press"). The validator previously only matched the "BB ..." display label, which fired 40 false-positive hard failures on the 4-day smoke test. Replaced exact-label match with regex alias matching that covers all library variants.

Smoke tests against Mira (client d43808bb):
- 4-day split (run `9240f7cb`): 12 mesocycle blocks correct, 4 days with Big 5 distributed 2x/week, passed=true.
- 5-day split (run `fb6b2534`): 5 days with the right titles, all 5 Big 5 present 2x/week, passed=true, 0 hard failures.

### What worked, and why

**3-meso mesocycle scheme worked because the deload week is forced into the structure, not optional.** The previous "linear set climb, no deload" scheme was easy to code but contradicts the consensus from Helms / Schoenfeld / ACSM. Now every 4th week is a built-in recovery, which is what the books recommend (Helms: "every 3rd meso minimum"). For the Cerebro client profile (general population, sleep-disrupted parents, returning lifters) we deload every meso, which is the safe bias.

**Days-per-week auto-distribution worked because the synthesis agent already has a deterministic builder for known phase types.** I extended `buildDeterministicPhase` to read `methodology_phase.days_per_week`, then route through three explicit Big 5 schedules (full body, U/L, P/P/L+U/L). No LLM call needed for the structural decision - same speed, same cost, more reliable output.

**Validator aliasing worked because Big 5 enforcement should be by exercise identity, not display label.** The library is the source of truth for what exists; the display label is just one of many ways to write the name. Regex matching on the actual exercise name (Back Squat / Front Squat / Barbell Squat) is robust against future library renames.

### How to prevent the errors that bit me in this session

1. **Mismatch between display label and library exercise name** is the recurring class of bug here. The synthesis agent picks exercises by regex against the library, then writes back `name = row.name` which is the LIBRARY name. So downstream validators / UI matchers must also use library aliases, never the "BB ..." display label as a literal string match. Lesson: any module that needs to identify a Big 5 lift should call a shared `isBig5(name)` helper, not match a hardcoded string. Right now `BIG_5_PATTERNS` lives inside the validator only; if a third place needs the same check, extract to a shared util.

2. **Hot-reload of edge functions cached old behaviour** never bit us this session but it could - if you deploy a new version and the orchestrator's prior in-flight `EdgeRuntime.waitUntil()` is still running, that one runs the OLD code. Symptom: a run launched at T-30s uses the old scheme even though new code is deployed. Fix: when you deploy, kick off a fresh smoke test, don't trust an already-running one.

3. **The methodology agent's AI call no longer drives the structural numbers.** The scaler is the source of truth for `week_blocks` and the deterministic builder is the source of truth for `days`. The AI is only adding `coaching_notes` and `cited_documents`. Don't refactor the agent to let the AI override these structural fields - that's how we get inconsistent output. If a future contributor wants the AI to be "smarter", make it adjust the FIRST meso's intensity for low compound_readiness clients (a tunable input to the scaler), not generate %s from scratch.

### Open tasks - all 16 closed

- [x] #1 - 4 client brain doc tables (drift on remote, no migration needed)
- [x] #2 - `pt_client_brain_chunks` table + RPC
- [x] #3 - `ingest-client-intake` edge function (deployed v1, verify_jwt true)
- [x] #4 - `embed-client-brain` edge function (deployed v1, verify_jwt false)
- [x] #5 - methodologyScaler pure function
- [x] #6 - client-analysis-agent edge function (v2, verify_jwt false)
- [x] #7 - methodology-plan-agent edge function (v3, verify_jwt false)
- [x] #8 - programme-synthesis-agent edge function (v3, verify_jwt false, phase-scoped with deterministic known-phase synthesis)
- [x] #9 - programme-validation-agent edge function (v2, verify_jwt false)
- [x] #10 - pt-programme-orchestrator edge function (v3, verify_jwt true, async pattern)
- [x] #11 - SKILL.md + programming-principles.md (compound substitution, Big 5, cardio/mobility)
- [x] #12 - Wizard new wiring + Step 1 file upload UI
- [x] #13 - PTProgrammeReviewView 4-agent breakdown (Codex shipped in `17e72ad`)
- [x] #14 - Smoke test (Mira run `00354c9e` - status=needs_review, 5 phases, all 5 Big 5 present in every Phase 2/3 day, all exercises have video_url + exercise_id)
- [x] #15 - Split synthesis per-phase (Codex shipped in `ee13954`)
- [x] cleanup - deleted `generate-pt-programme/` directory
- [x] #16 - Helms mesocycle scheme + 3/4/5 days/week selector (commit `a4cfbcd`)

### Next on the list: refine and improve

The structure is solid. The data underneath is now correct. The next phase is making the surface (rules, UX, polish) match the quality of what's underneath. Grouped by area, priority ranked within each:

**Rules (sharpen the methodology):**

- **#17 RPE targets per phase**, surfaced alongside %1RM. Helms 2nd ed: "intensity is primarily guided by repetition range and proximity to failure". The methodology agent should emit `rpe_target: '6-8' | '7-9' | etc` per block; the synthesis agent should write it to each Big 5 exercise as a `rpe` field; the UI should display "75% / RPE 8" not just "75%". Adds RPE to client and coach view without losing the % anchor.
- **#18 Deload week behaviour spec**. Right now deload weeks just drop sets and %. Helms also recommends drop volume, longer rest, possibly drop one accessory pair. Make the deload week visually distinct in the editor (badge or color) and make the rules explicit in SKILL.md.
- **#19 Compound readiness adjustment**. ClientAnalysis already emits `compound_readiness: 'low' | 'medium' | 'high'`. Today this output is unused by the scaler. Low readiness should shift the first meso down a tier (e.g. 60/65/70/55% instead of 65/70/75/60%) - delay heavy peaks until the body is ready. Wire the input.
- **#20 Phase 1 final-block compound substitution.** Validator + skill file already document the swap rule (goblet -> BB squat, etc) but the synthesis agent's deterministic Foundation builder doesn't emit the swap exercises explicitly. Today the same exercise list ships across all Foundation blocks. Add the substitution week so the last week_block visibly contains BB Squat / BB Deadlift / etc.
- **#21 Accessory selection by goal**. Today `pickAccessories` is a generic regex pool. For a fat-loss client, accessory selection should bias toward unilateral / metabolic finishers. For a strength-focused client, bias toward heavy compound accessories (front squat, pin pulls). Take `client_analysis.emphasis.priority` as input.

**UX (make it readable, editable, and trustworthy):**

- **#22 Programme editor meso/deload labels**. Each phase has 12 (or 10) one-week blocks. The editor should group blocks visually as "Meso 1 (weeks 1-4)" -> Build / Build / Peak / Deload, instead of a flat list of 12 entries. Coach scan time drops massively.
- **#23 Visible progression chart per phase**. A simple line/bar showing %1RM week-by-week with deload weeks marked. Same chart on coach review and client portal.
- **#24 Per-exercise edit picker.** When the coach wants to swap an exercise, today they edit the name in a text field. Should be a library autocomplete drawer with video preview and `exercise_id` linkage preserved.
- **#25 Client-facing weekly view**. Today the client sees their assigned programme but no week-by-week prescription. They should see "Week 5 of 12, Meso 2 build 1, target 67.5% on Big 5 / RPE 7" with their actual kg targets resolved from 1RM.
- **#26 Approve & Save flow with status messages**. The review page Approve button is there but feedback is minimal. After approve, push to `pt_program_assignments` with a clear "assigned to <client>" confirmation and link to the client detail page.
- **#27 Missing-exercise inline add**. If the synthesis agent reports `missing_exercises[]`, coach should be able to click "Add to library" inline (the wizard reaches out to `pt_exercises` with a name + suggested fields), then re-run the affected synthesis step without redoing the whole pipeline.

**Improvements (the deferred items from before):**

- **#28 Backfill `pt_client_brain_chunks`** for the 3 existing clients. One curl loop per client_id. Five minutes of work; full RAG coverage of existing clients.
- **#29 `client-analysis-agent` reads `pt_client_brain_chunks`**. Today the agent reads the 4 brain doc rows directly. With chunks indexed, a targeted RAG query ("injuries", "goals", "schedule", "preferences") would give more focused context when brain docs grow large.
- **#30 PDF / docx upload parsing**. Today wizard accepts txt/md only. Add browser-side extraction via `pdf.js` and a docx parser, or a new edge function that takes base64 and extracts server-side.
- **#31 Voice transcript channel split**. Wizard's voice button currently appends to the brain-dump textarea. Pass it as a separate `voice_transcript` field to ingest so the AI knows what was spoken vs typed.
- **#32 Retire legacy `pt-programming-agent`**. It's still deployed and the 1RM panel writes step rows to old runs. Migrate those touch points to the new orchestrator's runs, then delete the legacy function.

### What's NOT in scope but worth flagging for Pedro

These were intentionally left because Pedro hasn't asked for them yet, but they are obvious next steps if/when he does:

1. **PDF / docx file parsing in the wizard.** Current upload accepts text/markdown only. To accept PDF/docx, either (a) extract text in the browser via `pdf.js` and a docx parser, or (b) add a new edge fn that takes base64 file bytes and runs server-side extraction. (b) is cleaner because it can also OCR images later. The ingest agent already accepts pre-extracted `content_text`, so the wizard side is the only thing that needs changing.

2. **Wire the voice dictation transcript into the ingest call.** Right now the wizard's voice button populates `brainDump`. If the coach hits Save to client brain, the dump goes in as `notes_text`. That's fine, but a "voice_transcript" channel separate from typed notes is in the ingest function's API and unused. Could split with a UI toggle if Pedro wants the AI to know which content was spoken vs typed.

3. **Backfill `pt_client_brain_chunks` for the 3 existing clients.** They have brain doc data from prior sessions but no chunks yet (each session that runs ingest does it for that client only). For full RAG coverage on the existing clients, call `embed-client-brain` once per client:
   ```bash
   for id in d43808bb-eef1-49e6-b858-aa6c827c74ec 7e0023d9-a581-463c-8cdd-c144a204bf14 6fbd4d9b-f913-434c-a101-46c1d9acbe5d; do
     curl -X POST "${NEXT_PUBLIC_SUPABASE_URL}/functions/v1/embed-client-brain" \
       -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
       -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
       -H "Content-Type: application/json" \
       -d "{\"client_id\":\"$id\"}"
   done
   ```

4. **`client-analysis-agent` does not yet query `pt_client_brain_chunks`.** Today it reads the 4 brain doc rows directly. With chunks now indexed, you could add a RAG step that calls `match_client_brain_chunks` for targeted queries (goals, injuries, schedule, etc) before composing the ClientAnalysis. Reduces noise when brain docs grow large.

5. **The `pt-programming-agent` legacy function** (18-step monolith) is still on Supabase but the wizard doesn't call it. It's referenced by older code paths (`PTClientDetail.tsx` 1RM panel writes step_order 19/20 into its run). Don't delete it until Pedro confirms those touch points are wired to the new orchestrator's runs.

### Read these files first, in this order, BEFORE writing any code

1. **This file (`cerebro-site/HANDOFF.md`)** - everything below this section. It tells you the goal, why Pedro asked, what shipped, what walls were hit, what's left.
2. **`../session-logs/learning-log.md` Entry 026** - the five mistakes the previous session made, with prevention tactics for each. Do not repeat them.
3. **`../session-logs/rules-distilled.md`** - distilled lessons from prior sessions on this project.
4. **`../CLAUDE.md`** - project-wide rules (skill chain, session protocol, programme rules).
5. **`./CLAUDE.md`** and **`./AGENTS.md`** - Next.js + cerebro-site specific conventions.
6. **`../skills/pt-programming-workflow/SKILL.md`** - every PT programme rule that the AI must enforce.
7. **`~/.claude/plans/we-need-to-run-drifting-waffle.md`** - the approved rebuild plan with target architecture diagrams. Session 1 Progress at the bottom mirrors this file.
8. **`../Cerebro Knowledge/CEREBRO CLIENT ANALYSIS & PROGRAM GENERATION SYSTEM.md`** - Pedro's coaching framework.

If `~/.claude/projects/.../memory/project_pt_programming_overhaul_vision.md` is accessible to you, also read it - it has the auth pattern and implementation status condensed.

### Environment you're working in

- Repo root: `/Users/pedroavila/Library/CloudStorage/GoogleDrive-avila.phm@gmail.com/My Drive/WORK/Claude/Cerebro Directory Claude Code/`
- Site root: `cerebro-site/` (this is where most work happens)
- Skills + knowledge are one level up: `../skills/` and `../Cerebro Knowledge/`
- Plans: `~/.claude/plans/`
- Supabase project id: `otcnrkfvgyvwolironoz` (region ap-northeast-1)
- Anthropic SDK pinned at `npm:@anthropic-ai/sdk@0.65.0` in edge functions
- Supabase client pinned at `npm:@supabase/supabase-js@2` in edge functions
- Model used in agents: `claude-sonnet-4-6`
- `.env.local` has `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, etc. Source it for curl tests.

### Hard rules Pedro cares about (do not violate)

1. **Always commit and push after every change.** No exceptions. Pedro's memory says push to GitHub is part of every code change, no need to ask.
2. **No em dashes (-) or en dashes (-) in any `.md` file.** A pre-commit hook in the cerebro-site repo will reject the commit. Use a hyphen `-`. After editing any `.md`, run: `python3 -c "c=open('FILE.md').read(); open('FILE.md','w').write(c.replace('-','-').replace('-','-'))"`.
3. **Update `HANDOFF.md` and the task list before stopping a session.** Update `current state` so the next agent knows where to pick up.
4. **`git add -A` not glob patterns.** Next.js dynamic routes have `[id]` brackets that zsh interprets as globs. Documented in learning-log entry 020.
5. **No comments unless the WHY is non-obvious.** TypeScript strict mode, no `any`.
6. **Pedro picks the architecture.** When you face a fork, ask before guessing. He explicitly chose "3 separate Claude calls" and "brand-new orchestrator from scratch" - honour those choices even when shortcuts are tempting.

### Pre-flight checks (before you start coding)

```bash
# 1. Confirm you're on the latest commit
cd "/Users/pedroavila/Library/CloudStorage/GoogleDrive-avila.phm@gmail.com/My Drive/WORK/Claude/Cerebro Directory Claude Code/cerebro-site"
git log --oneline -5
# Latest should be 17e72ad "Add PT programme review agent breakdown" or newer

# 2. Confirm the 5 new edge functions are deployed
# Use supabase MCP or CLI to list them. Should see:
#   client-analysis-agent v2 (verify_jwt: false)
#   methodology-plan-agent v3 (verify_jwt: false)
#   programme-synthesis-agent deployed with verify_jwt: false
#   programme-validation-agent v2 (verify_jwt: false)
#   pt-programme-orchestrator deployed with verify_jwt: true

# 3. Confirm the migration applied
# Via SQL: select * from pt_client_brain_chunks limit 1; -- should not error
# Via SQL: select proname from pg_proc where proname='match_client_brain_chunks'; -- should return 1 row

# 4. Confirm pipeline state with no in-flight runs
# select status, current_command, count(*) from pt_program_generation_runs group by 1,2 order by 1;
# Anything in status='running' that's older than 10 minutes is dead - mark it failed before testing.
```

### Task #15: Split programme-synthesis-agent into per-phase calls (DONE)

**Why it mattered:** This was the only thing blocking the smoke test. Until synthesis returned a programme JSON, nothing downstream could be tested.

**Final architecture:**
- Orchestrator returns immediately with `run_id` and runs in `EdgeRuntime.waitUntil`.
- Client Analysis and Methodology Plan still use Claude calls.
- Synthesis now runs once per phase and logs steps 3-7.
- Known Cerebro phase types use deterministic synthesis from MethodologyPlan + ClientAnalysis + `pt_exercises`, because even per-phase LLM exercise JSON was too large.
- Validation runs at step 8.
- Wizard shows phase-specific progress labels.

**What changed:**

- `programme-synthesis-agent/index.ts` accepts a single-phase request:
```ts
const body = await req.json() as {
  client_analysis: Record<string, unknown>;
  methodology_plan_phase: Record<string, unknown>; // ONE phase from methodology_plan.phases
  phase_index: number;                              // 0..4
  programme_name?: string;                          // optional, only on first call
  programme_goal?: string;                          // optional, only on first call
};
```
- Return shape:
```ts
{
  ok: true,
  phase: { id, title, focus, weeks, progression, week_blocks, days },
  missing_exercises: string[],
  name?: string,   // returned only when phase_index === 0
  goal?: string,   // returned only when phase_index === 0
}
```
- Server post-processing enriches every exercise with `exercise_id`, `name`, `video_url`, `cues`, rest, notes, and conditional cardio/mobility blocks.
- Smoke run `00354c9e-13cf-4b94-8cea-66332fa493bf` completed `needs_review`, validation `passed=true`, 5 phases, 118 exercises, zero missing `exercise_id` or `video_url`, and 8 succeeded generation steps.

### Task #13: Coach review UI 4-agent breakdown (DONE)

File: `app/dashboard/pt/programmes/review/[id]/PTProgrammeReviewView.tsx`

The orchestrator stores rich data on `pt_program_generation_runs`:
- `coaching_reasoning.client_analysis` - full ClientAnalysis JSON
- `coaching_reasoning.methodology_plan` - full MethodologyPlan JSON
- `validation_summary.hard_failures` - array of strings
- `validation_summary.findings` - array of strings
- `validation_summary.missing_exercises` - array of strings

Shipped:
- 4 collapsible cards: Client Analysis, Methodology Plan, Programme Synthesis, Validation.
- Approval gate reads both new `validation_summary.hard_failures` and legacy `hard_rule_failures`.
- Programme Synthesis card surfaces total exercise objects, phase synthesis steps, unresolved links, and missing exercise warnings.
- Methodology card surfaces per-phase week blocks and cited documents.
- Client Analysis card surfaces goals, constraints, preferences, and emphasis flags.
- Validation card shows clean pass, hard failures, or findings.
- Re-run buttons are present as disabled stubs for future wiring.

### Tasks #3 + #4 (after #13): Step 1 multi-file upload + brain distributor

**Goal of these:** today the wizard only takes one text brain dump. Pedro's vision is 3 file uploads + text + voice, with AI distributing content into 4 brain doc tables.

**New edge fn `ingest-client-intake`:**
- Input: `{ client_id, files: [{name, content_base64, mime_type}], notes_text, voice_transcript }`.
- For each file: extract text. PDF -> use `npm:pdf-parse`, docx -> `npm:mammoth`, txt -> read directly. Skip OCR for v1 (no image support).
- Single Claude call: distribute all text into `{ master, nutrition, exercise, lifestyle }` JSON.
- Upsert each section to the 4 brain doc tables. Use the columns described in `client-analysis-agent` SELECTs.
- Fire `embed-client-brain` as fire-and-forget at the end.

**New edge fn `embed-client-brain`:**
- Input: `{ client_id }`.
- Read all 4 brain docs for the client.
- Chunk each (~500 tokens with 100-token overlap).
- Embed via OpenAI `text-embedding-3-small` (matches existing `pt_knowledge_chunks` dimension).
- Delete prior chunks for the client first, then insert fresh.
- Write to `pt_client_brain_chunks(client_id, doc_type, chunk_index, chunk_text, embedding, source_columns)`.

Both new fns deploy with `verify_jwt: false` (internal-only).

**Wizard Step 1 update** (`PTProgrammeWizard.tsx`):
- Add 3 file inputs (PDF/docx/txt, max 10MB each).
- Keep existing brain-dump textarea + voice button.
- "Continue to Step 2" button replaces the current Generate button. Calls `ingest-client-intake` with `{ client_id, files, notes_text, voice_transcript }`. Transitions to Step 2 on success.
- Step 2's existing "Generate programme" button stays the entry point for the orchestrator.

### Gotchas the previous session learned the hard way

1. **Schema drift.** `pt_clients.name` not `first_name`, `pt_clients.goals` not `goal`. Query `information_schema.columns` for ANY table before writing SQL.
2. **Edge-to-edge auth.** Internal edge functions must deploy with `verify_jwt: false`. Inter-edge `fetch` must send BOTH `Authorization: Bearer <service_role>` AND `apikey: <service_role>` headers. The platform rejects service-role tokens at the JWT verifier when called from another edge function.
3. **Sync requests die at 150s.** Any orchestration with multiple Claude calls must use `EdgeRuntime.waitUntil(...)` and return immediately with a `run_id`. Wizard polls the run row.
4. **Background tasks die at ~400s.** Even waitUntil has a ceiling. Don't try to do everything in one background task - chunk by natural boundary.
5. **Nested backticks in template literals are a silent bug.** Run `npx tsc --noEmit` after EVERY edit to a TS file with backtick-delimited strings.
6. **The 4 client brain doc tables exist on remote but not in local migrations.** Don't try to create them. The migration trigger that auto-inserts brain docs on `pt_clients` INSERT already works (3 existing clients have 3 rows each in each of the 4 tables).
7. **MCP deploy_edge_function takes content as a JSON-encoded `files` array.** Easy to break with backticks/newlines. Use `python3 -c "import json; print(json.dumps([{'name':'index.ts','content':open(...).read()}]))"` to safely encode, then paste the output into the deploy call.
8. **Status updates via REST need BOTH headers.** Tested working: `curl ... -H "apikey: $KEY" -H "Authorization: Bearer $KEY"`. The first time I tried with only apikey, it returned `[]` silently.

### Test clients available (have brain doc data already)

| Name | client_id | Status |
|---|---|---|
| Mira Juka | d43808bb-eef1-49e6-b858-aa6c827c74ec | active, has movement assessment notes |
| Thaisa | 7e0023d9-a581-463c-8cdd-c144a204bf14 | active |
| John Wick | 6fbd4d9b-f913-434c-a101-46c1d9acbe5d | active |

Use Mira for the first smoke test - her brain has the richest data (right shoulder instability + lower back concerns documented).

### What good looks like at end of your session

When you stop, the following should be true:
- Task #15 closed, smoke test passes end-to-end against Mira.
- `pt_program_generation_runs` for Mira shows `status='needs_review'`, 5 phases in `programme_draft`, validation `passed=true`.
- A new commit on `main` describing the per-phase synthesis split. Pushed to GitHub.
- `HANDOFF.md` updated: "Last updated" date, "Last completed task" describing what you did, next steps trimmed (tasks #13, #3, #4 remain).
- A new entry in `../session-logs/learning-log.md` covering anything surprising you encountered.
- If you completed task #13 too: review UI cards visible, "Approve & Save" gating works.

If you get stuck in the same way I did, escalate to Pedro before sinking another hour. The pattern I missed for too long was that the synthesis Claude call was fundamentally too big for one shot - I tried two fixes (slim library, drop max_tokens) before accepting the architectural change was needed.

---

## The Goal (Pedro's vision, approved 2026-05-20)

Rebuild the PT programme creation flow inside `/dashboard/pt/programmes/new` so that a single coach action produces a fully-populated, validated, knowledge-grounded training programme. The system has three big steps:

**Step 1 - Coach inputs everything we know about a client.** Coach picks a client, uploads up to 3 documents (intake forms, assessment notes, anything), types or voice-dictates their own observations. The AI distributes that content into the four client "brain" docs on Supabase:
- `pt_client_brain` (master profile, who they are, goals)
- `pt_client_nutrition_doc` (current eating, preferences, restrictions)
- `pt_client_exercise_doc` (current training, movement assessment, injuries)
- `pt_client_lifestyle_doc` (sleep, stress, schedule, hobbies)

All four are then RAG-indexed so any future AI can retrieve relevant client context.

**Step 2 - Coach chooses how many weeks each phase will last.** Fixed arc: Phase 1 Foundation, 1RM Test, Phase 2 Hypertrophy, Phase 3 Strength, 1RM Retest. Defaults: 7/1/12/10/1 weeks. Coach edits any of these, clicks Generate.

**Step 3 - Three AIs work in sequence to build the programme.**
1. **Client Analysis AI** reads all four brain docs via RAG, outputs structured ClientAnalysis JSON: goals, constraints, preferences, emphasis flags (`needs_cardio_block` for fat-loss clients, `needs_mobility_block` for mobility-focused clients, `compound_readiness` low/medium/high).
2. **Methodology Plan AI** reads the 19-document knowledge base via RAG (Helms training/nutrition pyramids, ACSM physiology, Precision Nutrition, Pedro's coaching philosophy, etc), scales canonical week_blocks to the coach's chosen weeks, outputs MethodologyPlan JSON.
3. **Programme Synthesis AI** combines client analysis + methodology plan + filtered exercise library, populates every phase/day/exercise with an `exercise_id` linked to `pt_exercises` so videos and cues auto-attach. Enforces non-negotiable rules.

**Non-negotiable rules:**
- **Phase 1 Foundation**: exactly 3 full-body days. Weeks 1-2 = 2 sets. Weeks 3-5 = 3 sets. **Last 2 weeks: compound substitution** (goblet squat -> BB Squat, KB/DB deadlift -> BB Deadlift, DB bench -> BB Bench Press, lat pull-down -> Pull-up, DB shoulder press -> BB Shoulder Press).
- **Phase 2 (Hypertrophy) + Phase 3 (Strength)**: every workout day MUST include all 5 Big 5 lifts at the top with `weight_pct` from `week_blocks`. Accessories sprinkled after. Percentages scale algorithmically when phase weeks change.
- **1RM Test / Retest**: Big 5 only, 5 sets each.
- **Every workout day**: 4 warm-up exercises + 6 main exercises in 3 supersets.
- **Conditional blocks**: cardio block (15-20 min steady) if `needs_cardio_block`; mobility block (10-15 min flexibility) if `needs_mobility_block`.
- **Every exercise must carry `exercise_id`** from `pt_exercises` library so `video_url` and `cues` join back automatically.
- **% to kg auto-resolves** when the coach enters Big 5 1RMs (`recalculate-percentage-loads` edge fn already does this).

Approved follow-up: `/Users/pedroavila/.claude/plans/we-need-to-run-drifting-waffle.md` has the full rebuild plan. `~/.claude/projects/.../memory/project_pt_programming_overhaul_vision.md` has the vision in long-term memory.

---

## Why Pedro asked for this

The old wizard called a lite edge function (`generate-pt-programme`) that:
- Had no RAG (knowledge base ignored).
- Had no link back to the exercise library, so generated exercise objects had no `video_url` and no `cues`. Videos didn't render on cards.
- Had a minimal system prompt with none of the Big 5 / week_blocks / compound substitution rules.
- Didn't read the client's existing brain docs.

The symptoms Pedro reported:
1. Programmes didn't create 3 workouts for Phase 1, 2, 3.
2. Exercises weren't pulled from `pt_exercises`.
3. Exercise videos missing on workout cards (despite every library row having a YouTube `video_url`).
4. Sets on Phase 1 blank.
5. Reps and percentages missing on Phase 2 and 3.
6. The programme didn't reflect the unique findings from movement assessment + client notes pasted into Step 1.
7. Knowledge docs never cited.

Root cause: the wizard hit the lite function, not the heavier `pt-programming-agent` orchestrator. The orchestrator existed but the wizard wasn't pointed at it. Even the heavier orchestrator was one Claude call dressed up as 18 commands - not the true multi-agent flow Pedro wanted.

---

## What this session shipped (commit chain: 578f54d -> 19e956c)

### Database

**`20260520000000_pt_client_brain_chunks.sql`** applied to remote.
- New table `pt_client_brain_chunks` (id, client_id, doc_type, chunk_index, chunk_text, embedding vector(1536), source_columns) for future client-scoped RAG.
- New RPC `match_client_brain_chunks(query_embedding, target_client_id, match_count, match_threshold)`.
- pgvector ivfflat index, RLS for Pedro/admins.

Important drift note: the 4 brain doc tables (`pt_client_brain`, `pt_client_nutrition_doc`, `pt_client_exercise_doc`, `pt_client_lifestyle_doc`) **already exist on the remote DB** (each has 3 rows matching 3 clients). They were created directly on remote without a local migration file. Did not recreate.

### Edge functions (5 new, all deployed to project otcnrkfvgyvwolironoz)

| Function | Version | verify_jwt | Purpose |
|---|---|---|---|
| `client-analysis-agent` | v2 | false | Reads 4 brain docs + intake text. Single Claude (sonnet-4-6) call. Returns ClientAnalysis JSON. |
| `methodology-plan-agent` | v3 | false | Calls `retrieve-knowledge-context` 5x for phase rules. Scales week_blocks via pure function. Single Claude call. Returns MethodologyPlan JSON. |
| `programme-synthesis-agent` | v3 | false | Loads filtered `pt_exercises`. Single Claude call (max_tokens 10000) generates entire PTProgramme. Server post-process attaches `video_url`+`cues` from library. |
| `programme-validation-agent` | v2 | false | Pure-code hard rules: >=5 phases, Foundations=3 days, week_blocks complete, Big 5 in Phase 2/3, 1RM=Big 5x5, exercise_id non-null. |
| `pt-programme-orchestrator` | v3 | true | User-facing. Creates `pt_program_generation_runs` row. Wraps the 4-agent chain in `EdgeRuntime.waitUntil()` and returns `{ run_id, status: 'running' }` immediately. Pipeline runs in background. |

### Wizard

`app/dashboard/pt/programmes/new/PTProgrammeWizard.tsx`:
- `generateFromDump` now calls `pt-programme-orchestrator` instead of the old lite function.
- Requires clientId (the new flow needs the client brain).
- Infers `phase_weeks` from the phase template via new helper `inferPhaseWeeks()`.
- Polls `pt_program_generation_runs` every 3 seconds and surfaces per-agent progress chips ("Analysing client...", "Planning methodology...", "Synthesising programme...", "Validating...").
- On terminal state, hydrates the wizard from `programme_draft` + `validation_summary` (name, goal, hard_failures, findings, missing_exercises).

### Utilities

`utils/pt/methodologyScaler.ts` (new): canonical week_blocks for Foundation/Hypertrophy/Strength, `scaleWeekBlocks(kind, targetWeeks)` pure function, Big 5 names, foundation substitution rule. Inlined into the methodology-plan-agent and available for future scaling work.

### Skill / knowledge updates

`/skills/pt-programming-workflow/SKILL.md` extended with:
- Phase 1 compound substitution rule (with the exact swap list).
- Big 5 enforcement section for Phase 2/3.
- Conditional cardio/mobility block rules.
- 1RM Test/Retest spec.
- Updated validation list matching the new agent.

### Memory + plan files

- `~/.claude/plans/we-need-to-run-drifting-waffle.md` - the approved rebuild plan with target architecture, gap map, implementation steps, verification checklist.
- `~/.claude/projects/.../memory/project_pt_programming_overhaul_vision.md` - long-term memory entry capturing the full vision so future sessions inherit context without re-discovering it.
- `MEMORY.md` index updated to point at the new memory file.

---

## Mistakes during the session and what fixed them

These are the four real walls we hit, in order. Each one taught something I want future-me (or future-Claude) to know before they hit it.

### 1. Schema drift on pt_clients
Wrote agent SQL using `pt_clients.first_name` / `.goal`. The actual columns are `name` / `goals`. Direct curl returned 404 from the agent's "Client not found" check. **Fix:** SQL `information_schema.columns` lookup before writing any agent that touches `pt_clients`. **Lesson:** never assume a schema - this DB has organic drift from being modified outside the local migrations.

### 2. Edge-to-edge auth: 401 from internal agents
First version of the orchestrator did `fetch(.../client-analysis-agent, { headers: { Authorization: 'Bearer <service_role>' } })`. Returned 401 every time. The platform's JWT verifier rejected service-role tokens originating from another edge function, even though direct curl with the same key worked. **Fix (two parts):**
- Add `apikey: <service_role>` header alongside `Authorization`. Matches the pattern in the existing `pt-programming-agent -> retrieve-knowledge-context` call chain.
- Deploy internal agents with `verify_jwt: false`. Only the user-facing orchestrator stays `verify_jwt: true`. This matches `retrieve-knowledge-context`, which is also verify_jwt false and does its own auth check inside the function body.

**Lesson:** Supabase has a contract for service-role calls between edge functions that isn't well-documented. Look at how existing internal-only functions are deployed before deploying new ones.

### 3. Synchronous edge function = 150s wall (and then 400s wall)
First orchestrator iteration ran all 4 agents sequentially inside a single HTTP request. The wizard waited on the response. Supabase killed the request at 150s with HTTP 546 "WORKER_RESOURCE_LIMIT". **Fix:** wrap the pipeline in `EdgeRuntime.waitUntil(runPipeline(...))` and return `{ run_id, status: 'running' }` immediately. Wizard polls `pt_program_generation_runs` for status.

This bought us a longer execution budget for the background work (around 400s based on testing) but it wasn't infinite.

### 4. Synthesis Claude call is too slow for one mega-prompt (RESOLVED)
Even with the async pattern + the exercise library pre-filtered down to ~150 entries + `max_tokens` dropped to 10000, the synthesis Claude call generating an entire 5-phase programme JSON still exceeds the background execution budget. The function hangs on the Claude SDK call for 300+ seconds and gets killed by the platform without writing a result.

Why this is fundamental: each exercise object in the output is ~80-120 tokens (id, name, sets, reps, rest, notes, section_start, superset_id, etc). A 5-phase programme with ~3 days per training phase + Big 5 + accessories + warm-ups = roughly 200 exercise objects = ~20K output tokens. Sonnet generates ~50-100 tok/s, so the output alone needs 200-400s. That overlaps with the platform timeout.

**Fix shipped as task #15:** orchestrator now loops `foundation -> 1rm_test -> hypertrophy -> strength -> 1rm_retest`, records each synthesis step separately, stitches the returned phases, then validates at step 8. The synthesis function now uses deterministic known-phase synthesis from the methodology plan and exercise library, with server-side enrichment for `video_url`, `cues`, and conditional blocks.

**Lesson:** large structured generation jobs that bump against edge function execution caps need to be chunked, not optimised. Don't try to fit a 200-object JSON into one Claude response.

---

## Current state of the pipeline (what works, what doesn't)

| Step | Status | Time | Notes |
|---|---|---|---|
| Orchestrator kickoff | WORKING | ~2-4s | Returns run_id, kicks off background pipeline. |
| Step 1: Client Analysis | WORKING | ~20s | Reads 4 brain docs + intake text, returns ClientAnalysis JSON. |
| Step 2: Methodology Plan | WORKING | ~40s | 5 RAG calls + 1 Claude call. Returns MethodologyPlan JSON. |
| Step 3: Programme Synthesis | WORKING | ~15s after methodology | Runs 5 phase-scoped synthesis steps and stitches `programme.phases[]`. |
| Step 4: Validation | WORKING | ~1s | Smoke run passed with zero hard failures and zero findings. |
| Wizard polling | WORKING | ~3s tick | Surfaces per-agent and per-phase progress correctly. |
| Coach review page | WORKING | - | 4-agent breakdown cards render from `coaching_reasoning`, synthesis steps, and validation summary. |

---

## Next steps and why (priority order)

### Step 1: Build Step 1 upload UI + `ingest-client-intake` + `embed-client-brain` (tasks #3 and #4) - PRIORITY 1
**Why:** today the wizard only takes a text brain-dump in Step 1. Pedro's vision is 3 file uploads + text + voice, with the AI distributing content into the 4 brain doc tables. Without this, generating a programme for a brand-new client requires manually populating their brain docs first.

**How:**
- New edge fn `ingest-client-intake`: accepts files + text + voice transcript, extracts text from each, single Claude call distributes into `{ master, nutrition, exercise, lifestyle }` JSON, upserts to the 4 brain doc tables.
- New edge fn `embed-client-brain`: chunks all 4 docs for a client, embeds via OpenAI `text-embedding-3-small`, writes to `pt_client_brain_chunks`.
- Wizard Step 1: 3 file inputs (PDF/docx/txt), keep text + voice. "Generate" button calls `ingest-client-intake`, transitions to Step 2.

### Step 2: Delete the old lite function and verify production - PRIORITY 2
**Why:** keeps the codebase clean. The wizard no longer calls `generate-pt-programme`, so it's dead code. Removing it forces the new path to be the only path.

**How:** wait until full smoke test passes end-to-end. Then `rm -rf supabase/functions/generate-pt-programme/`, redeploy, run smoke test once more.

---

## Smoke test checklist (current end-to-end path)

1. Open `/dashboard/pt/programmes/new` as Pedro.
2. Pick one of the 3 existing clients (Mira / Thaisa / John). Their brain docs already have data.
3. Type intake notes describing the client's goals/constraints.
4. Click Generate.
5. Wizard shows progress chips: Analysing -> Planning methodology -> Synthesising phase 1/5 -> ... -> Validating. Total ~3-4 minutes.
6. Step 2 loads the generated programme. Verify:
   - Phase 1 has exactly 3 workout days, week_blocks with sets, compound substitution in last 2 weeks.
   - Phase 2 and Phase 3 every workout day contains all 5 Big 5 lifts with `weight_pct` from week_blocks.
   - Every exercise card shows a YouTube video.
   - 1RM Test and Retest contain Big 5 only with sets="5".
   - Cardio/mobility blocks appear if client analysis flagged them.
7. SQL check: `select * from pt_program_generation_runs order by created_at desc limit 1;` shows `status='needs_review'`, `programme_draft` populated, `validation_summary` with `passed=true`, zero `hard_failures`.
8. SQL check: `select * from pt_program_generation_steps where run_id = '...' order by step_order;` shows 8 step rows, all `status='succeeded'`.
9. Open `/dashboard/pt/programmes/review/[run_id]`, verify the 4 cards: Client Analysis, Methodology Plan, Programme Synthesis, Validation.
10. Approve in coach review UI, open draft in editor, save assignment.
11. Enter Big 5 1RMs on client detail page, click Recalculate loads, confirm kg appears under each Big 5 across Phase 2 and 3.

---

## Files changed this session

```
NEW
  cerebro-site/supabase/migrations/20260520000000_pt_client_brain_chunks.sql
  cerebro-site/supabase/functions/client-analysis-agent/index.ts
  cerebro-site/supabase/functions/methodology-plan-agent/index.ts
  cerebro-site/supabase/functions/programme-synthesis-agent/index.ts
  cerebro-site/supabase/functions/programme-validation-agent/index.ts
  cerebro-site/supabase/functions/pt-programme-orchestrator/index.ts
  cerebro-site/utils/pt/methodologyScaler.ts

MODIFIED
  cerebro-site/app/dashboard/pt/programmes/new/PTProgrammeWizard.tsx
  cerebro-site/app/dashboard/pt/programmes/review/[id]/PTProgrammeReviewView.tsx
  cerebro-site/HANDOFF.md (this file)
  skills/pt-programming-workflow/SKILL.md
  ~/.claude/projects/.../memory/MEMORY.md
  ~/.claude/projects/.../memory/project_pt_programming_overhaul_vision.md (new)
  ~/.claude/plans/we-need-to-run-drifting-waffle.md
```

Recent commits on main for this rebuild:
- `578f54d` - initial 3-AI rebuild
- `19e956c` - auth, async, and exercise-library filter fixes
- `ee13954` - split PT programme synthesis by phase
- `17e72ad` - add PT programme review agent breakdown

---

**MANUAL SMOKE TEST CHECKLIST:**
1. Pick one of the 3 existing clients on /dashboard/pt/programmes/new. Their brain docs already have data - the client-analysis-agent will read them.
2. Type some intake notes ("client wants fat loss, has lower back stiffness, 3x/week schedule").
3. Click Generate. Watch status: "Analysing client… Planning methodology… Synthesising programme… Validating…" (each agent takes 10-30s).
4. On success: Step 2 loads with the generated programme. Inspect:
   - Phase 1 has 3 workout days, week_blocks with sets
   - Phase 2 & 3 every day has Big 5 + accessories
   - Every exercise has a video_url (visible in PTDayEditor)
   - 1RM Test/Retest have Big 5 only, 5 sets each
5. Check Supabase: `select * from pt_program_generation_runs order by created_at desc limit 1;` - should show status='needs_review', programme_draft populated, validation_summary with hard_failures/findings/missing_exercises.
6. `select * from pt_program_generation_steps where run_id = '...' order by step_order;` - 4 step rows, all 'succeeded'.

Previous completed task:
Client Metrics Tracking System - compute-client-metrics edge function deployed:
- DB migration applied: `training_metrics` JSONB column on `pt_client_exercise_doc`, `adherence_metrics` JSONB column on `pt_client_nutrition_doc`.
- New edge function `compute-client-metrics` (deployed v1, --no-verify-jwt): accepts `{ client_id }`, queries last 28 days of `pt_set_logs` to classify exercises as push/pull/hinge/squat/core/other by keyword matching and compute volume (weight x reps) per category per ISO week. Queries `pt_workout_logs` for workout frequency and all-time count. Queries last 30 days of `pt_nutrition_logs` for tracking rate, daily avg macros, and protein/calorie hit rates vs `daily_targets`. Writes structured JSON to `training_metrics` on exercise doc and `adherence_metrics` on nutrition doc.
- `update-client-brain` (v7): after `applyBrainUpdates()`, fires compute-client-metrics as fire-and-forget when `trigger_type === 'workout_logged'` or `trigger_type === '1rm_result'`.
- `log-nutrition` (v6): fires compute-client-metrics as fire-and-forget after every meal log.
- `skills/client-metrics-retrieval/SKILL.md`: new skill documenting the full metrics schema, movement classification keywords, hit rate definition, recomputation triggers, and single-query retrieval pattern.

Previous completed task:
pt-programming-agent v11 deployed - Mandatory week_blocks for all 3 phases + full knowledge base retrieval:
- `programming-principles.md`: Phase 2 Hypertrophy and Phase 3 Strength week_blocks are now MANDATORY (not examples). Both phases now require BOTH `sets` AND `weight_pct` in every block. Phase 2 default: 4 blocks at 65/68/72/75% with 3/4/4/5 sets (12 weeks). Phase 3 default: 4 blocks at 77/80/85/88% with 4/4/5/6 sets (10 weeks). Added Knowledge Base section listing all 19 docs with mandatory cross-reference rules.
- `pt-programming-agent/index.ts`: DEFAULT_PRINCIPLES updated to match. SYSTEM_PROMPT updated to mandate week_blocks and require all knowledge docs referenced. `buildContext()` now fetches full `pt_knowledge_documents` catalog. `compactGenerationContext()` passes `knowledge_base_catalog` to AI. `validateProgramme()` adds hard rule failures if Hypertrophy or Strength phases are missing `week_blocks`, `weight_pct`, or `sets`.
- `retrieve-knowledge-context/index.ts`: DOCUMENT_PRIORITY expanded from 8 to 18 entries (all 19 indexed docs now have explicit priority ranks). DEFAULT_MATCH_COUNT raised 12 -> 18. Match count cap raised to 25. buildRetrievalQuery priority hint updated to include all document names.
- `skills/pt-programming-workflow/SKILL.md`: New skill file documenting the exact workflow rules, all mandatory week_block schemes, and the full knowledge base catalog. Lives in `../skills/pt-programming-workflow/`.
- Both functions redeployed to Supabase project `otcnrkfvgyvwolironoz`. Commit: 72c44c8. Build passes.

Previous completed task:
pt-programming-agent v10 deployed - Programming principles rewrite + Phase 1 day count enforcement:
- `programming-principles.md` completely rewritten with all Cerebro hard rules: full 6-phase programme arc (mandatory), Phase 1 = exactly 3 full-body days, warm-up pool (17 exercises), compound tempos (exact seconds for all Big 5), Hypertrophy 65-75% / 8-15 reps / 3-5 sets, Strength 75-90% / 3-8 reps / 4-6 sets, nutrition sync per phase, core coaching philosophy.
- `index.ts` `DEFAULT_PRINCIPLES` updated to compact version of same rules.
- `validateProgramme()`: Phase 1 / Foundations day count is now a hard rule failure (not a finding). If the AI generates a foundations phase with anything other than 3 days, the run is marked `failed` and Pedro sees the violation immediately.
- Warm-up count mismatch (not exactly 4) remains a finding (not a hard failure) in case Pedro adjusts.
- Deployed as v10 to Supabase (project: otcnrkfvgyvwolironoz).

Previous completed task:
PT programming architecture Phase 10 - Final integration (OVERHAUL COMPLETE):
- `PTClientDetail.tsx`: `saveOneRmResults()` now inserts a `STORE_1RM_RESULTS` step (step_order 19) into `pt_program_generation_steps` when the active assignment has a `generation_run_id`. `recalculateLoads()` inserts a `RECALCULATE_PERCENTAGE_LOADS` step (step_order 20) on success. Both are fire-and-forget (`void`) so they never block the UI.
- RLS verified: Pedro's auth emails have full access to `pt_program_generation_steps` via the `pt admins full generation steps` policy.
- DB smoke test: 1 generation run, 18 steps, 4 retrieval logs, 3 review outputs (all connected). Phase nutrition and 1RM counts are zero because no live client has run the full flow yet (expected).
- Commit: 8d93689. Build passes.
- **All 10 phases of the PT Programming System Overhaul are now complete.**

**MANUAL TEST CHECKLIST (full end-to-end):**
1. Go to a client detail page → Programming Agent → Generate new programme
2. Review it at `/dashboard/pt/programmes/review/[run_id]`, approve each review output
3. Open draft in editor → Phase Nutrition panel appears → expand, approve each phase
4. Save programme → `pt_phase_nutrition` rows created, assignment saved
5. Back on client detail → 1RM entry panel → enter Big 5 results → Save results
6. Click "Recalculate programme loads" → confirm kg hints appear in programme editor
7. Go to review page → Command trail should now show STORE_1RM_RESULTS (step 19) and RECALCULATE_PERCENTAGE_LOADS (step 20)
8. Apply to client daily targets → confirm client sees updated macros in NutritionTab

Previous completed task:
PT programming architecture Phase 8/9 - Review output approval:
- `PTProgrammeReviewView.tsx`: `reviewOutputs` prop converted to local state so approvals reflect immediately.
- `approveOutput()`: updates `pt_program_review_outputs.status = 'approved'` for a single row, then patches local state.
- Review outputs moved from compact 2-column Evidence panel into a dedicated full-width section with expanded `findings`, `hard_rule_failures`, and a per-output Approve button. Green border + checkmark when approved, red border when failures exist.
- Evidence section simplified to referenced documents full-width only.
- `PTProgramReviewOutput` type: added `'approved'` to status union in `utils/pt/types.ts`.
- Commit: 50ab807. Build passes.

Previous completed task:
PT programming architecture Phase 7 - Nutrition Synchronization Engine:
- `app/dashboard/pt/programmes/[id]/edit/page.tsx`: now loads `pt_phase_nutrition` rows by assignment_id. If no rows exist and `generation_run_id` is set, fetches `nutrition_draft` from `pt_program_generation_runs` as fallback. Passes both as props to PTProgrammeEditView.
- `PTProgrammeEditView.tsx`: replaced `phaseNutritionDraft` (untyped unknown[]) with `nutritionRows: PhaseNutritionRow[]`. Initialized from DB rows → generation run draft → sessionStorage revision draft (in priority order). Added `PhaseNutritionRow` interface and `toNutritionRows()` / `extractRecText()` helpers at module level.
- Phase Nutrition panel added to editor (between Phases and Workouts sections): collapsible card per phase showing training_context and an editable recommendations textarea. Editing a phase resets it to 'draft' status.
- Approve button per phase: immediately upserts the row to `pt_phase_nutrition` with `review_status: 'approved'`.
- When all phases approved: "Apply to client daily targets" button appears.
- Apply modal: pre-fills 5 macro fields (protein_g, carbs_g, fat_g, fibre_g, calories) from current `pt_client_nutrition_doc.daily_targets`. Pedro edits and confirms → updates the client's nutrition doc. Client sees updated targets in NutritionTab.
- `save()` now preserves each row's `review_status` instead of forcing 'approved' on all phases.
- Commit: a17ab5c. Build passes.

Previous completed task (Phase 6 - Percentage Engine):
- Added `PT1RMTest` and `PT1RMResult` types to `utils/pt/types.ts`.
- `PTClientDetail.tsx`: 1RM entry panel with the Big 5 exercises (BB Squat, BB Deadlift, BB Bench Press, BB Shoulder Press, Pull-up). Pedro enters tested weight + reps. Epley formula computes estimated 1RM live. Warm-up ramp shown per exercise (empty bar 6 reps, then 50/65/75/85% chips, then 1RM target). Saves to `pt_client_1rm_tests` + `pt_client_1rm_results`. Calls `update-client-brain` with `trigger_type: '1rm_result'`. Test history displays below.
- `page.tsx`: queries `pt_client_1rm_tests` with nested `pt_client_1rm_results` and passes as `oneRmTests` prop.
- New edge function `recalculate-percentage-loads` (deployed `--no-verify-jwt`): reads latest `pt_client_1rm_results`, fuzzy-matches exercise names to Big 5, resolves every `weight_pct` in `week_blocks` and exercise `week_overrides` to kg, stores `one_rm_map` on `pt_program_assignments.validation_summary`, updates `pt_client_exercise_doc.current_1rm`.
- `PTDayEditor.tsx`: when a block is active and `weight_pct` is set, shows `~Xkg` hint below the input if 1RM is stored.
- `PTProgrammeEditView.tsx`: phase block summary chips show kg resolution per exercise (e.g. "Squat ~62.5kg | Deadlift ~80kg") when `one_rm_map` is present on the assignment.
- Commit: b00eea3. Build passes.

Previous completed task:
PT programming architecture Phase 5 deterministic orchestration:
- Extended `pt-programming-agent` from session-only draft generation into the first deterministic programme orchestration path.
- The function now creates a `pt_program_generation_runs` row, writes the full ordered command audit trail in `pt_program_generation_steps`, calls `retrieve-knowledge-context` with run/step IDs, generates a coach-review programme draft, stores coaching reasoning, phase roadmap, programme draft, phase nutrition draft, and validation summary on the run, and creates `pt_program_review_outputs` rows for program/nutrition/system review.
- Added validation so new programmes that collapse below the full Cerebro phase arc are marked `failed` instead of silently looking usable. Drafts still return to the editor for Pedro review/editing.
- Programme editor/create flows now preserve `generation_run_id` and `validation_summary` when Pedro saves the template/assignment, and the draft banner shows validation finding counts.
- `retrieve-knowledge-context` now accepts the configured service key in-function and was redeployed with `--no-verify-jwt` so Phase 5 server-side orchestration can call it while preserving explicit auth checks.
- `update-client-brain` now has in-function auth and was redeployed with `--no-verify-jwt` so service-key orchestration can request structured brain updates without relying on gateway JWT format.
- Deployed `pt-programming-agent` version 9, `retrieve-knowledge-context` version 4, and `update-client-brain` version 6 to Supabase project `otcnrkfvgyvwolironoz`.
- Verification: `npm run build` passes. Live smoke test created a run with 18 command steps, 1 retrieval log, and 3 review outputs; test artifacts were deleted afterward. The smoke prompt intentionally asked for a concise draft and validation correctly marked the one-phase output as `failed`.
- Also present from the starting worktree: client workout scroll reset on Begin Workout and removal of glass/backdrop treatment from active workout exercise sections to prevent iOS invisible text.

Previous completed task:
Exercise library expansion - 105 new exercises added with full data + YouTube video URLs:
- Added 105 exercises across 8 categories: dumbbell variations, single arm, single leg, mobility (CARs, Jefferson Curl, etc.), flexibility, bodyweight (Pike Push Up, Archer Push Up, Wall Walk, etc.), banded loop, resistance band with handle
- Each exercise has: name, primary_muscles, secondary_muscles, muscles, equipment, tags, purpose, conditions, setup_cues, cues, source="ai", video_url
- 103/105 got YouTube video URLs via yt-dlp; 2 (Wall Walk, Banded Overhead Press) had no video found
- Script: `scripts/add-new-exercises.py` - pass SERVICE_ROLE_KEY as arg; uses curl for Supabase calls, yt-dlp for YouTube search
- Bug fixed in script: `source` column has a check constraint - must be "ai" not custom values
- Exercise library now has ~503 exercises total (was 398)
- Also this session: food logging progress ring (SVG circular progress, 0-95% easing), client portal loading screen with greeting + progress, PT dashboard loading screens via loading.tsx + PTPageLoading.tsx, all 398 original exercises populated with video_url via populate-exercise-videos.py (310/311 done, "Banded Pull Apart" failed)

Previous completed task:
PT programming architecture Phase 4 Client Brain architecture:
- Extended the existing Client Master Brain instead of creating a duplicate memory system.
- `update-client-brain` now accepts structured programming-memory triggers: `client_document_analysis`, `program_generation`, `phase_nutrition`, `coach_decision`, and `1rm_result`.
- Structured document/program analysis now writes to existing Phase 2 fields: `pt_client_brain.coaching_reasoning`, `pt_client_brain.important_decisions`, `pt_client_exercise_doc.movement_assessment_summary`, `pt_client_exercise_doc.progression_strategy`, `pt_client_nutrition_doc.eating_habits.nutrition_priorities`, `pt_client_nutrition_doc.phase_nutrition_strategy`, and `pt_client_exercise_doc.current_1rm`.
- `ai-client-chat` now reads those structured brain fields and includes them in the long-term client memory context so the AI coach can use coaching reasoning, movement assessment, progression strategy, phase nutrition, decisions, and structured 1RM entries.
- Updated shared PT types for the new brain fields.
- Deployed `update-client-brain` version 5 and `ai-client-chat` version 7 to Supabase project `otcnrkfvgyvwolironoz`.
- Verification: `npm run build` passes. Temporary client smoke test confirmed structured document analysis, phase nutrition, and 1RM paths write the expected brain fields; temporary client and cascade brain/activity rows were deleted after verification.
- Note: no new database tables were added in Phase 4. The implementation intentionally uses the existing client brain tables plus Phase 2 columns.

Previous completed task:
PT programming architecture Phase 3 knowledge retrieval system:
- Added and deployed `retrieve-knowledge-context` Edge Function to Supabase project `otcnrkfvgyvwolironoz`.
- Implements the `RETRIEVE_KNOWLEDGE_CONTEXT` command for later programming phases. Inputs support `taskType`, `phaseType`, `clientGoal`, `questionOrDecision`, optional `runId`, optional `stepId`, and optional retrieval tuning.
- Uses existing `pt_knowledge_documents`, `pt_knowledge_chunks`, and hardened `match_knowledge_chunks` RPC. No second knowledge-base table or duplicate persistence system was introduced.
- Source-of-truth docs now live in stable project folder `../Cerebro Knowledge/`: `CEREBRO MASTER SYSTEM PROMPT.md` and `CEREBRO CLIENT ANALYSIS & PROGRAM GENERATION SYSTEM.md`.
- Ingested those two docs into the live PT knowledge base as `cerebro_architecture` documents: `CEREBRO MASTER SYSTEM PROMPT` (`190d5eca-83d4-4ea4-86e2-a84251dfa185`, 8 chunks) and `CEREBRO CLIENT ANALYSIS & PROGRAM GENERATION SYSTEM` (`04709fb9-22f0-41a7-8b67-3d1bf586bc46`, 5 chunks).
- Updated retrieval priority matching so those exact architecture document titles rank as priority 1.
- Writes every retrieval to `pt_knowledge_retrieval_logs` with excerpts, applied rules, referenced documents, confidence score, and low-confidence flag.
- Auth supports service-role orchestration and Pedro/admin dashboard users only.
- Verification: `npm run build` passes; Supabase function deploy succeeded; initial live smoke test returned 12 excerpts, logged row `9d8ec662-0419-4341-a85b-2391dbe6f97d`, confidence `0.576`, `low_confidence=false`; MCP SQL verified the retrieval-log row. After architecture-doc ingestion and ranking patch, final smoke test logged row `e3aea25b-4cd0-4b0f-9cbe-f932a28e358f` and returned both `CEREBRO MASTER SYSTEM PROMPT` and `CEREBRO CLIENT ANALYSIS & PROGRAM GENERATION SYSTEM` as priority sources.
- Note: legacy functions (`generate-pt-programme`, `parse-client-document`, `ai-client-chat`, `query-knowledge-brain`) still contain their older inline retrieval logic. Phase 4+ programming orchestration should call `retrieve-knowledge-context` before generation, then older generation paths can be retired or refactored once the deterministic engine replaces them.

Previous completed task:
Client dashboard UI overhaul (commits ed6a526 through 963fd40):
- Chat (MessageBubble.tsx): scroll lock on open (targets `.client-liquid > div`), context-aware workout banner only when on Workout screen, full-screen overlay on mobile + floating panel on desktop, Claude-style input card (warm gray bg, textarea + icon row), live voice transcription via Web Speech API shown in real time, icon sizes updated to iOS standard (44px touch targets, 22px SVGs, 48px send circle)
- Overview screen: Workout widget now before MacroWidget; Goals section hidden (not deleted); "Next workout" mini-card is now a button navigating to Workout tab
- Nutrition screen: delete button (x) on each food log entry with spinner + RLS DELETE policy added; "Track your food here" CTA button below Today's Macros; NutritionChatModal (full-screen z-60 overlay) with voice brain dump, gallery multi-photo (up to 10), camera capture, text input, photo tip banner, "Log food" button calling log-nutrition-batch
- log-nutrition-batch edge function (new, deployed --no-verify-jwt): accepts text + up to 10 photos + current_time, single Claude Sonnet call with all image blocks, returns JSON array of meals split by type, inserts each as separate pt_nutrition_logs row, 28-day purge + weekly avg update; reads client context from pt_clients + pt_client_nutrition_doc to calibrate estimates
- log-nutrition edge function updated: also reads client context (goals, daily targets, favourite foods, foods to avoid, typical meals, eating habits, recurring gaps), passes to text and photo parse functions
- Workout screen: programme title card removed; Journey timeline moved to top in both assigned and unassigned states
- Icon sizes (both chats): touch targets w-11 h-11 (44px), SVGs 22px (+/mic/camera), stop square 20px, send circle w-12 h-12 (48px) with 18px arrow, Log food pill h-11

Previous completed task: PT programming architecture Phase 2 Supabase extensions:
- Added and applied migrations `20260519015541_pt_programming_architecture_phase_2.sql` and `20260519020058_pt_programming_phase_2_fk_indexes.sql` to Supabase project `otcnrkfvgyvwolironoz`.
- New PT programming tables: `pt_client_documents`, `pt_program_generation_runs`, `pt_program_generation_steps`, `pt_knowledge_retrieval_logs`, `pt_client_1rm_tests`, `pt_client_1rm_results`, `pt_phase_nutrition`, `pt_program_review_outputs`, and `pt_extra_sessions`.
- Extended existing architecture instead of duplicating it: `pt_clients` now references intake/assessment documents; programme assignments/templates can link back to generation runs and validation summaries; client brain docs now have coaching reasoning, important decisions, movement assessment summary, progression strategy, and phase nutrition strategy fields.
- Hardened existing Supabase functions `create_client_brain_docs` and `match_knowledge_chunks` with explicit `search_path` and restricted execute grants. Supabase security advisors no longer flag those functions.
- Added missing indexes for all new Phase 2 foreign keys after Supabase performance advisors flagged them.
- Verification: MCP migrations applied successfully; new tables have RLS enabled and policies; rollback smoke insert covered documents, generation runs, steps, and retrieval logs; `npm run build` passes.
- Remaining Supabase advisor warnings are pre-existing and outside this phase: `pg_net` in public, public `blog-headers` bucket listing, leaked password protection disabled, and older RLS/index performance warnings on existing tables.
- Note: `supabase db push --dry-run` is still blocked by remote migration history drift. Until local/remote migration history is reconciled, use MCP `apply_migration` or direct SQL for phase migrations and verify manually.

Previous completed task:
Exercise library seed completed + YouTube video batch (this session):
- Seeded all 398 exercises (400 list, 2 minor duplicates skipped) with AI-generated metadata: primary_muscles, secondary_muscles, conditions, setup_cues, equipment, tags
- Fixed Haiku name-suffix bug (was appending category in parens to name); deleted 95 bad rows, redeployed with `name: batch[idx].name` fix
- Both edge functions redeployed with updated auth: `--no-verify-jwt` + service role JWT accepted via JWT payload decode (role: 'service_role')
- YouTube batch run: 87/398 exercises now have video_url. YouTube free-tier quota (10k units/day = 100 searches/day) exhausted. Run again daily until all are populated.
- Video batch command: `curl -s "https://otcnrkfvgyvwolironoz.supabase.co/rest/v1/pt_exercises?select=id&video_url=is.null&limit=100" -H "Authorization: Bearer $SERVICE_KEY" -H "apikey: $SERVICE_KEY" | python3 -c "import json,sys; data=json.load(sys.stdin); print(json.dumps({'exercise_ids': [r['id'] for r in data]}))" | curl -s -X POST "https://otcnrkfvgyvwolironoz.supabase.co/functions/v1/search-exercise-videos" -H "Authorization: Bearer $SERVICE_KEY" -H "Content-Type: application/json" -d @- --max-time 120`

Previous completed task: PT Sessions new-client/programme visibility and workout brain memory (commit: current HEAD):
- Fixed `/dashboard/pt/pt-sessions` so clients with `invited` status now appear alongside active clients. This makes newly added clients available for session tracking before they complete client-login setup.
- Verified in the browser that newly created client Mira Juka appears in PT Sessions and her assigned workout programme loads.
- New clients created from `/dashboard/pt/clients` now start with `use_brain: true`.
- Coach-logged workouts from PT Sessions now call `update-client-brain` with the workout title, phase/day/block/week, and all logged set rows after saving `pt_workout_logs` and `pt_set_logs`.
- Updated and redeployed `update-client-brain` so `workout_logged` updates the client brain even if an older client has `use_brain` disabled. Other trigger types still respect the feature flag.
- Verification: `npm run build` passes; `supabase functions deploy update-client-brain` succeeded. Targeted lint still reports pre-existing React 19 `set-state-in-effect` errors in `PTSessionsView.tsx`.

Previous completed task: Dashboard contrast and padding audit (commit: ae8ab38):
- Fixed the shared liquid dashboard/client CSS so solid black buttons use true white text instead of the warm page background token.
- Raised muted dashboard text tokens (`text-black/15` through `text-black/70`) to readable contrast levels inside the Cerebro dashboard and PT dashboard skins.
- Added minimum control height and fallback padding for dashboard/client buttons and bordered action links so cramped controls have a consistent tap target.
- Strengthened input text and placeholder contrast, and kept light/glass action controls on stronger off-white surfaces.
- Verification: `npm run build` passes; browser contrast scan across `/dashboard`, `/dashboard/leads`, `/dashboard/bookings`, `/dashboard/pt/overview`, `/dashboard/pt/clients`, `/dashboard/pt/programmes`, `/dashboard/pt/exercises`, and `/dashboard/pt/settings` returned zero failures.

Previous completed task: Seed exercise library auth fix (commit: edadd01):
- Fixed `seed-exercise-library` Edge Function auth after it had been changed to a hardcoded `x-trigger-token`.
- Restored the standard `Authorization: Bearer ${INTERNAL_SECRET}` check used by the rest of the project.
- Preserved the new optional `{ "limit": number }` request body support and `remaining` response field.
- Redeployed `seed-exercise-library` to project `otcnrkfvgyvwolironoz`.
- Verification: `npm run build` passes; unauthenticated deployed function request returns `401` as expected. Local `.env.local` does not include `INTERNAL_SECRET`, so authorized seed invocation was not run locally.

Previous completed task: Client booking calendar UI spacing (commit: 7de4b13):
- Added more top breathing room before the first 6am row in the client booking day/week calendar grid.
- Moved booking slots, time labels, and grid lines down together so the first available slot no longer crowds the date header.
- Month view now starts from today for the current month instead of showing past/blank days before today. Previous months are still reachable with the left arrow.
- Verification: `npm run lint -- app/client/ClientPortal.tsx` passes with existing warnings only; `npm run build` passes; mobile browser smoke test on `/client` booking tab passed.

Previous completed task: Client workout UI refinements (commit: 6aefdd3):
- Workout preview section cards now have consistent padding, rounded off-white surfaces, and exercise counts in the card header.
- Exercise logger sheet now uses off-white instead of grey and keeps set labels/inputs at black text contrast.
- Logged set rows visually soften once reps are entered, while unlogged rows remain white/black.
- Removed the bulky black next-exercise preview card between exercises. Replaced it with compact direction strips: next exercise, next section, or superset instructions with rounds based on programmed set count.
- Section notes now appear inline at the end of each section instead of all grouped at the bottom.
- Journey progress now includes 1RM Test after Phase 1 and 1RM Re-test after the final phase.
- Verification: `npm run lint -- app/client/ClientPortal.tsx` passes with warnings only; `npm run build` passes; mobile browser smoke test on `/client` passed.

Previous completed task: Exercise library - 400 exercises, card UI, YouTube search, rich client workout view (commit 69c7092):
- DB migration: primary_muscles, secondary_muscles, conditions, setup_cues, progression_ids, regression_ids added to pt_exercises (with GIN indexes)
- PTExercise type extended with all 6 new fields
- Edge function seed-exercise-library: seeds 400 exercises across 8 categories (strength compound/isolation, core, mobility, cardio, golf, running, pilates), Claude Haiku generates metadata per batch of 15; trigger via curl with INTERNAL_SECRET
- Edge function search-exercise-videos: YouTube Data API v3 searches for short demo videos per exercise, updates video_url; requires YOUTUBE_API_KEY secret; callable for single exercise (from dashboard Find video button) or batch
- PT dashboard: new /dashboard/pt/exercises page with grid (YouTube thumbnails), search + filters, slide-over detail panel (video embed, muscles, setup cues, verbal cues, conditions, progressions/regressions), full edit mode with Find Video button, autocomplete progression/regression linker
- PTNav: Exercises link between Programmes and Knowledge
- ClientPortal: workout logger batch-fetches rich exercise data on Begin Workout; shows primary muscles; Setup cues collapsible above Verbal cues

Previous completed task: Client workout logger mobile UI overhaul (commit: current HEAD):
- Reworked client workout logging after "Begin workout" into exercise-by-exercise mobile screens.
- Each exercise now leads with a large demo area, with YouTube embeds configured for muted autoplay/loop when the exercise is active.
- Added scroll-aware active exercise detection so only the exercise currently in view loads its autoplay video.
- Replaced the old section accordion logger with an overlapping rounded logging sheet: exercise title, target, Verbal cues toggle, Last time toggle, and the existing set/weight/reps inputs.
- Added black "Next exercise" preview cards below each exercise screen.
- Preserved existing set draft, add/remove set, section notes, and Finish workout save behavior.
- Verification: `npm run lint -- app/client/ClientPortal.tsx` passes with warnings only; `npm run build` passes; mobile browser smoke test on `/client` passed.

Previous task: Settings tab, Booking rename, 5-item nav, weight detection in chat (commit 32a4d05):
- Renamed Tools tab to Booking in ClientPortal
- Added Settings tab (5th nav item): Profile (name/last_name/phone/gender/date_of_birth saved to pt_clients), Change Password (re-verify current pw then updateUser; reset email option), Body Metrics (collapsible, moved from booking screen)
- PTClient type updated with last_name/phone/gender/date_of_birth fields
- ai-client-chat: detectWeightMention() auto-logs specific weight to pt_client_metrics (source=chat) + coaching task for Pedro; if vague weight mention, AI asks for number
- Bottom nav is now 5 items (Overview / Nutrition / Workout / Booking / Settings), compact sizing (h-11, text-[0.58rem])
- DB: pt_clients needs profile columns for Settings Profile to work - see pending tasks below

Previous task: Nutrition tab, macro widget, live voice transcription, fibre tracking (commit f8d16dc):
- Voice input replaced with Web Speech API live transcription - words appear in textarea as client speaks, editable before send, normal send flow (ai-client-chat detects food intent from text)
- Photo food logging now also extracts fibre_g in response
- New NutritionTab.tsx: 7-day selector (navigate back weeks), macro progress bars (protein/carbs/fat/fibre/calories vs daily targets from pt_client_nutrition_doc.daily_targets), meals grouped by Breakfast/Snack/Lunch/Dinner sections
- New MacroWidget.tsx on Overview screen above workout card: compact 4-macro grid, taps to open Nutrition tab
- Bottom nav expanded to 4 items: Overview / Nutrition / Workout / Tools (Salad icon from lucide)
- DB migration applied: fibre_g added to pt_nutrition_logs, daily_targets jsonb to pt_client_nutrition_doc (default: 150g P / 200g C / 65g F / 30g fibre / 2000 kcal), client-read RLS policy on pt_client_nutrition_doc, index on (client_id, logged_at DESC)
- log-nutrition edge function: fibre in all parse paths + prompt, 28-day rolling purge, redeployed

Previous task: Photo and voice food logging in client chat (commit 73877c1):
- Camera icon in MessageBubble.tsx opens image picker (capture="environment" opens camera on mobile)
- Mic icon click-to-start/stop records voice via MediaRecorder API (prefers audio/webm;codecs=opus)
- Both paths: file converted to base64, sent to log-nutrition edge function
- On success: food-log summary message inserted into pt_messages ("Logged: [meal] - [kcal] - [P/C/F]"), then ai-client-chat triggered to respond
- extract-client-note also fired for brain doc updates
- Error state shown if log-nutrition can't parse ("try again or type what you ate")
- log-nutrition edge function redeployed to project otcnrkfvgyvwolironoz

Previous task: Client Brain System - Phase 1 (commit 5106644):
- 7 new Supabase tables: pt_client_brain, pt_client_nutrition_doc, pt_client_exercise_doc, pt_client_lifestyle_doc, pt_client_recent_activity, pt_nutrition_logs, pt_conversation_summaries
- DB trigger auto-creates all 4 brain doc rows when a client is created
- Existing 2 clients seeded with empty brain docs
- use_brain boolean column added to pt_clients (default false, feature-flagged rollout)
- New edge function: update-client-brain - writes every interaction to hot inbox (pt_client_recent_activity), then if use_brain=true runs Claude Haiku extraction and updates the relevant specialist doc
- New edge function: log-nutrition - parses food from text/photo/voice using Claude, stores in pt_nutrition_logs, updates pt_client_nutrition_doc weekly averages
- Updated edge function: ai-client-chat (v4) - now reads all 4 brain docs when use_brain=true and adds them to AI context as "Long-Term Client Memory"; detects food intent and routes to log-nutrition; calls update-client-brain async after every response
- TypeScript types added: PTClientBrain, PTClientNutritionDoc, PTClientExerciseDoc, PTClientLifestyleDoc, PTClientRecentActivity, PTNutritionLog, PTConversationSummary
- Git tag: stable-baseline-pre-brain (safe rollback point before this work)
- Storage bucket: pt-nutrition-logs created for photo/audio files

NEXT STEPS:
1. TOMORROW: Re-run YouTube video batch (quota resets daily) until all 398 exercises have video_url. Command above. Run daily until populated. Currently: 87/398 done, 311 remaining.
2. Enable use_brain=true on one test client via Supabase Dashboard to verify the brain system end-to-end
3. Add workout log trigger to call update-client-brain with trigger_type: 'workout_logged'
4. Weekly email content: weight delta from pt_client_metrics should appear in weekly progress email (coaching task is created on weight detection, but email content not yet built)
5. PT dashboard: add ability to set per-client daily macro targets (currently defaults: 150g P / 200g C / 65g F / 30g fibre / 2000 kcal)
6. Consider changing Booking tab icon from Wrench to CalendarDays

Previous task: AI coach chat fix (commit 0b8719a):
- Root cause: `pt_messages.sender` CHECK constraint only allowed `'pt'` and `'client'`. The `ai-client-chat` edge function inserts with `sender='ai'`, which was rejected by the constraint. The function returned 200 regardless (no error check on the insert), so the thinking indicator cleared but no message ever appeared.
- Fixed: applied migration `20260516000600_allow_ai_sender_in_pt_messages.sql` to extend the constraint to include `'ai'`. Also added insert error handling in the edge function so future failures surface in logs.
- Redeployed `ai-client-chat` edge function.

Previous task: Programmes: global template flow + clickable cards + assign-to-client copy (commit bb148af):
- Wizard now saves to `pt_program_templates` (global). Client selection is now optional - it provides AI generation context; if selected, an assignment copy is also created alongside the template.
- Programmes list: template cards now link to `/programmes/template/[id]`; assignment cards link to `/programmes/[id]/edit`.
- New template detail page (`/programmes/template/[id]`): shows name, goal, phase list with workout days, "Edit template" and "Assign to client" buttons.
- "Assign to client" opens inline dropdown; on confirm calls `POST /api/pt/programmes/assign` which deep-copies the template's `programme` JSON into a new `pt_program_assignments` row with `template_id` reference. Editing the client's copy never touches the template.
- New template edit page (`/programmes/template/[id]/edit`): full phase/workout editor saving to `pt_program_templates`.
- New `/api/pt/programmes/assign` route: reads template, inserts assignment copy, fires `programme_assigned` event.

Previous task: Email-triggered Google Calendar sync for PT bookings (commit 8bde126):
- edge function sends calendar-sync emails to avila.phm@gmail.com on booking/cancellation
- ~/.cerebro/gmail-calendar-sync.py checks Gmail every 5 min via gws, creates/deletes calendar events
- ~/Library/LaunchAgents/au.cerebroai.gmail-calendar-sync.plist runs it automatically

Previous task: Dashboard tracking fix + UI cleanup (commit 106f3a7):
- Root cause: `SUPABASE_SERVICE_ROLE_KEY` was missing from both `.env.local` and Vercel production. Every insert into `page_visits` and `site_events` was silently failing inside a try/catch, leaving both tables at 0 rows despite all tracking code being wired correctly.
- Fixed: added key to `.env.local` and pushed to Vercel via CLI (`vercel env add`). Vercel project linked to `avilaphms-projects/cerebro`.
- Removed `TrafficSources` card from `/dashboard` (redundant with WebsiteStats last-7-days card).
- Removed UTM tracking links section from `WebsiteStats.tsx`. Empty state message cleaned up.
- Tracking stack confirmed correct: `VisitTracker` in root layout fires `sendBeacon` to `/api/track/visit` on every public page load; `GetInTouchSection` fires `chat_started` and `email_submitted` events; `/api/track/duration` updates time-on-page on tab hide/close. All routes use service role key. RLS policies allow service role full access. Next Vercel deploy will start recording real visitor data.

Previous task: Per-client AI coach + voice brain dump + PT knowledge brain (commit c95cbce):
- `ai-client-chat` edge function: receives `{ client_id, message_id, content }`, fetches client goals/programme/logs/check-ins/coaching notes, searches knowledge base (RAG, cosine similarity), builds full context system prompt, calls gpt-4.1-mini, inserts AI response to `pt_messages` with `sender='ai'`; detects "hey pedro" -> sets `ai_handoff_requested=true` on client message + creates `pt_coaching_tasks` entry
- `query-knowledge-brain` edge function: embeds query, cosine searches knowledge base, generates answer from indexed content only using gpt-4.1-mini (no hallucination mode)
- `ingest-knowledge-document` v2: added voice note path - receives `voice_audio_base64` + `voice_mime_type` + `title`, transcribes via Whisper, creates text-only document (no file_path), ingests chunks; existing file path extracted into `ingestTextForDocument()` helper
- `pt_messages`: added `ai_handoff_requested boolean default false` + partial index
- `MessageBubble.tsx`: invokes `ai-client-chat` after every client message send, shows AI messages in light-blue bubble with "AI Coach" label, "Thinking..." bubble while waiting, "Pedro notified" on handoff messages; header changed to "AI Coach" with Pedro mention hint; marks 'ai' and 'pt' messages as read_at
- `KnowledgeBaseManager.tsx`: voice recording section with Start/Stop buttons (MediaRecorder API, webm), "Test your PT brain" chat section calling `query-knowledge-brain`
- `PTMessagesView.tsx`: AI messages shown with blue bubble and "AI Coach" label, amber "Client requested Pedro - take over" banner shown inline when `ai_handoff_requested=true`

Previous task: Knowledge base RAG system + web search for programme generation (commit c7db554):
- DB: `pt_knowledge_documents` + `pt_knowledge_chunks` tables live on remote with pgvector (1536-dim), IVFFlat index, `match_knowledge_chunks` RPC for cosine similarity search
- Storage bucket `pt-knowledge-docs` created with PT admin RLS policies
- Edge function `ingest-knowledge-document`: extracts PDF text via OpenAI Files API, chunks at 1500 chars, embeds with `text-embedding-3-small`, stores in `pt_knowledge_chunks`
- `generate-pt-programme` and `parse-client-document` both updated: accept `phase_template`, run knowledge base search + web search (`gpt-4o-mini-search-preview`) in parallel before generation; phase structure is now FIXED by the template
- `PTProgrammeWizard` passes current phase template to both generation functions
- `/dashboard/pt/knowledge` page: upload PDFs/docs, triggers ingestion, lists documents with chunk counts, delete
- Knowledge nav item added to PTNav
- AI generation no longer replaces the 5-phase structure -- it populates workout days within it

Previous task: Programme creation rules: section order, default template, cascade weeks (commit 37c359e):
- `utils/pt/programme.ts` exports `CANONICAL_SECTION_ORDER` (Warm Up, Workout, MetCon, Stretches), `DEFAULT_PROGRAMME_PHASES` (5-phase journey), `sortExercisesBySectionOrder()`, and `getPhaseStartWeeks()`
- `PTDayEditor.tsx`: section picker offers only Warm Up/Workout/MetCon/Stretches. Assigning a section auto-sorts exercises into canonical order.
- `PTProgrammeWizard.tsx`: initialises with 5 default phases pre-filled. AI generation replaces them.
- Both wizard and edit view show "starts week X" per phase, live cascade.
- `ClientPortal.tsx` `getWorkoutSections` sorts by canonical order at render time.
- Rules written to top-level CLAUDE.md.

Previous task: Build fix (commit 5e10822): `PTSessionsView.tsx` was missing `created_at` on a `WorkoutLog` object literal added by another session, causing Vercel type-check failure. Added `created_at: new Date().toISOString()`.

Also this session: client overview page redesign (commits df5ac49, 6c6eb03):
- "This Week" + "Overview" merged into one "Overview" card with "This Week's Focus" sub-header, week date range, coach note, and three mini items: Next session / Due today / Next workout
- Sessions left counter moved to a fixed badge at top-right beside the message bubble (no sub-text)
- Plan card converted to a collapsible toggle (collapsed by default, chevron + done count in header)
- Monthly Review removed from overview page; unused `reviews` state and `pt_coaching_reviews` query removed

Previous task: Workout tab journey timeline rules locked in (commit a460195):
- Journey timeline is now a standalone card, always visible for ALL clients
- No programme assigned: shows default 5-phase fallback (Phase 1 - Foundation, Testing 1 RM, Phase 2 - Hypertrophy, Phase 3 - Strength, Re-testing 1 RM)
- Programme assigned: phases come from `assignment.programme.phases[n].title`
- Week numbers never shown anywhere in client-facing progress UI (Pedro extends weeks freely)
- Block sub-checkpoints use `block.sets` or `block.weight_pct` as labels, never week count
- Journey card sits below workout cards; workouts stay at top of screen
- Active programme label removed from first card (programme name only)
- renderProgressPanel (weight/waist/adherence) removed from workout screen
- Stronger completed workout card glow: `rgb(46,213,115)` neon shadow lifts card
- Rules written to top-level CLAUDE.md under CLIENT TRAINING PROGRAMME RULES

Previous task: Booking session rules overhaul (commit 0bd4e22):
- Removed "Active programme" label from first card; programme name only
- Removed `renderProgressPanel` (weight/waist/adherence) call from workout screen
- Phase card now sits directly under the programme card with nothing between them
- `renderProgress` replaced with a collapsible journey timeline: horizontal line with one circle per phase, green when phase is complete, dark ring for active, gray for upcoming; expands to show block sub-checkpoints per phase (small circles, green when block done); chevron indicates state
- Completed workout card glow made significantly stronger - large positive y-offset shadow in green, 2px bottom gradient line at full card width, subtle green border tint; matches timeline checkpoint color `rgb(46,213,115)`

Previous task: Booking session rules overhaul (commit 0bd4e22):
- Sessions ONLY deduct on Finish Session (complete) or No Show - not on booking or cancellation
- Removed `booking_hold` ledger inserts on booking creation and `hold_released` on cancellation
- Removed "held by future bookings" display from client portal overview card
- Replaced Pack/Held/Open 3-stat block on booking screen with single "Sessions left" stat
- `canBook` now checks `sessions_remaining > 0` directly - clients with sessions can book freely
- Client with 0 sessions sees red warning banner and cannot book on the calendar
- Added No Show button in PT Sessions view (below Workout Programme card) - deducts 1 session
- Workout days now stack vertically full-width instead of 2-3 col grid
- Added `noShowBooking` edge function action
- Added `sendSessionAlerts` cron action (0 or 1 session + booking in next 24h emails)
- DB migration adds 'no_show' to `pt_session_ledger` entry_type check constraint

## Last commit
this commit - Add PT programme review agent breakdown

## Current state

Dashboard and client portal use the liquid glass design direction from the Claude Design handoff bundle, with the client portal refined toward a lighter premium coaching cockpit.

Shipped most recently:
- Task #13 is complete: `/dashboard/pt/programmes/review/[id]` now renders 4-agent review cards for Client Analysis, Methodology Plan, Programme Synthesis, and Validation, with approval gated on hard failures from both new and legacy validation keys.
- Task #15 is complete: `/dashboard/pt/programmes/new` now uses the async orchestrator, phase-level synthesis, deterministic known-phase expansion, validation at step 8, and phase-level polling labels. Mira smoke run `00354c9e-13cf-4b94-8cea-66332fa493bf` passed cleanly.
- Remaining PT programme creation work is Step 1 ingestion: build `ingest-client-intake`, build `embed-client-brain`, and update wizard Step 1 to accept 3 files + notes + voice before generation.
- PT programming architecture Phase 4 is complete: structured programming analysis now updates the existing Client Master Brain, and AI chat reads those fields as long-term coaching memory. No new memory system was introduced.
- PT programming architecture Phase 3 is complete: `retrieve-knowledge-context` is deployed and writes auditable retrieval logs for deterministic programming generation. No coach-review UI or programme-generation engine changes were made in this phase.
- PT programming architecture Phase 2 is complete at the database layer. The system now has persistent structures for intake/assessment documents, deterministic generation runs and command steps, retrieval logs, 1RM testing/results, phase-linked nutrition, review-agent outputs, and extra sessions. No frontend workflow or generation engine implementation has been added yet.
- AI weekly check-in system: `pt_checkin_sessions` table (migration applied to remote), `client-ai-checkin` edge function (deployed), `WeeklyCheckinModal.tsx` component, Goals card "Weekly Check-in" button with pulsing DUE badge, This Week's Focus card (3-col exercise/nutrition/sleep). Removed all `WeeklyResetDraft` / `submitWeeklyReset` dead code from `ClientPortal.tsx`.
- Edge function reads Pedro's `pt_booking_availability` + `pt_booking_blocks` to generate open PT slots, passes client context + calendar screenshot (Claude vision) to `claude-sonnet-4-6`, auto-creates `pt_weekly_plan_items` for activities, upserts `pt_weekly_checkins`, and creates a coaching task for Pedro on completion.
- `PTClientDetail.tsx` and `page.tsx` already include AI Check-in Sessions section (last 8 sessions, per-session focus card, activity list, health tips).

Previously shipped in this session:
- Audited the coach PT dashboard mobile experience across Overview, Messages, Bookings, Clients, Groups, Programmes, Emails, Settings, client detail, and programme editor/create flows.
- Fixed the shared PT layout so the PT nav becomes a horizontal scroll rail on mobile and remains a sidebar on desktop.
- Added `min-w-0` to dashboard shells to prevent nested content from squeezing or causing hidden horizontal overflow.
- Reworked PT Overview mobile spacing: one-column metrics on narrow phones, stacked list rows, smaller page padding, and responsive operations grids.
- Reworked coach Messages so message loading scrolls only the message pane instead of pushing the whole dashboard upward.
- Adjusted coach Bookings, Clients, Groups, Programmes, Emails, Settings, client detail, and programme editor/create pages with responsive padding, stacked headers, full-width mobile actions, and scroll-safe modals.
- Booking calendar overhaul: PT day view has top padding (6am no longer clips), day view removes horizontal scroll, week and month views show Mon-Fri only, past days in current month are dimmed (arrows reveal past months), PT availability windows appear as green background bands on the calendar, PT availability form has labeled fields.
- Client calendar: day toggle replaced with 3-days (next 3 weekdays from tomorrow, skipping weekends), week is Mon-Fri only, month is Mon-Fri only with past days dimmed, Move session option jumps to the booking's week so client can pick a new slot (same-week only), cancel + rebook in sequence via manage-pt-booking.
- Client calendar modal UX: clicking an available slot opens a step-by-step booking modal (slot info -> confirm time + repeat -> booked). Owned sessions render in blue with client name. Clicking a blue slot opens an options sheet: Book another session (date picker, shows available times), Move this session (same day or another day within the week; Friday -> next Mon/Tue), Cancel (outside 24h = simple confirm; within 24h = reason textarea -> Pedro reviews on PT dashboard).
- Restored the client booking calendar as a true visual calendar instead of a compact slot list.
- Client Tools now uses Google Calendar-style day/week time grids with a left time rail, hour lines, and positioned Available/Busy/Yours blocks.
- Client monthly view now shows compact event bars inside day cells, with day/week/month toggles above the calendar.
- Coach `/dashboard/pt/bookings` now uses the same day/week/month calendar language, with client names visible on appointment blocks and a selected appointment action panel.
- Installed two UI/UX Codex skills from GitHub for future sessions: `ui-design` and `ui-ux-design-pro`. Restart Codex before relying on them as named skills.
- Fixed the client portal scroll shell by using a stable viewport-height app container, an internal scroll pane, and extra bottom padding above the floating nav.
- Raised the client footer nav off the bottom safe area and moved the client message bubble to the top right.
- Increased client portal form/control readability and softened rounded control styling within the dashboard skin.
- Reworked the Tools booking calendar into day, week, and month views. Day/week show available, busy, and own booked slots; month only shows booked days.
- Added calendar-driven cancellation: clicking an owned booking opens cancellation, and late cancellations prompt for a reason before sending Pedro an approval request.
- Moved Body Metrics from Overview to Tools, moved the progress summary from Overview to Workout, and placed the next session at the top of Tools.
- Replaced the loud green completed-workout card treatment with a subtle under-card glow and restrained black check state.
- Downloaded and read the Claude Design bundle from `https://api.anthropic.com/v1/design/h/oZbR-OuOAm6vkIqUehlDQA`, including README, transcript, and the admin/client HTML prototypes.
- Added a scoped liquid glass system in `app/globals.css` for `/dashboard` and `/client` surfaces only.
- Updated the main dashboard layout/sidebar to use a floating dark glass sidebar, warm monochrome background, translucent panels, rounded controls, and soft inner highlights.
- Updated the PT dashboard shell/nav to inherit the same glass system while preserving the nested PT navigation structure.
- Updated the client portal root and bottom nav to match the glass direction without affecting public marketing pages.
- Added `session_duration_minutes` and `buffer_minutes` to PT booking availability. Defaults are 45 minute sessions and 5 minute buffers.
- Booking blocks now reserve the session plus buffer, while appointments and Google Calendar events stay at the true 45 minute session time.
- Client `/client` Tools tab now shows a calendar-style booking widget with available, busy, and own-booking states.
- Pedro `/dashboard/pt/bookings` now shows a coach calendar with client names, booking status, and quick complete/cancel controls.
- Client booking rules are server-side: 48 hours minimum notice, 28 day horizon, recurring bookings inside the horizon, credit holds for future bookings, cancellation request inside 24 hours.
- Friday morning booking reminder automation is scheduled in Supabase Cron through `manage-pt-booking` action `send_weekly_reminders`.
- Google Calendar sync on booking create/cancel now fails soft and preserves the booking flow if the external sync endpoint or Google API is down.

Recent shipped surfaces include:
- `/dashboard/bookings` internal booking cockpit backed by Supabase booking tables.
- `/dashboard/leads` lead pipeline and tag-based stage tracking.
- `/dashboard/pt` PT dashboard, client portal, programme, messaging, coaching, and review workflows.
- Public marketing routes including `/`, `/finance`, `/operators`, `/blog`, `/privacy`, and `/terms`.
- No outstanding tracked phases remain in the repo right now.

## Clean Slate Rules
- There are no active saved phase lists.
- There are no active saved todo lists.
- Do not infer next work from deleted plans.
- For new work, use Pedro's current brief.

## Known Notes
- Do not run `supabase db push`. Remote migration history is ahead of local. Use `supabase db query` or MCP migration paths.
- Full repo lint has pre-existing failures outside recent work. Prefer targeted build/type verification.
- Pre-commit hook rejects em dashes in markdown files. Use plain hyphens.
- Supabase Cron job `pt-booking-weekly-reminders` is active on project `otcnrkfvgyvwolironoz` with schedule `0 22 * * 4`, which maps to Friday morning Sydney time in the current timezone.
- `send_session_alerts` action is ready in `manage-pt-booking` but needs a daily cron set up in Supabase Dashboard (e.g. `0 22 * * *` = 8am Sydney daily). Use the same internal secret bearer pattern as weekly reminders.
- Google Calendar sync is wired in `manage-pt-booking` through `GOOGLE_CALENDAR_SYNC_URL` or `GOOGLE_CALENDAR_ACCESS_TOKEN` plus `GOOGLE_CALENDAR_ID`. No Google secret was present locally, so calendar writes will no-op until one of those secrets is configured.
- Coach booking notifications: `COACH_NOTIFY_EMAIL` defaults to `pedro@cerebroai.au`, `COACH_CALENDAR_EMAIL` defaults to `avila.phm@gmail.com`. Coach calendar attendance only fires when the existing Google Calendar sync secrets are set. The email piece works as long as `RESEND_API_KEY` is set.
- Resend email sending uses existing `RESEND_API_KEY` and `RESEND_FROM_PEDRO_NOTIFY` Edge Function secrets when available.
- Security advisor still reports `pg_net` installed in `public` from the live project. Attempting `ALTER EXTENSION pg_net SET SCHEMA extensions` is not supported by the extension, so this was left as an existing non-blocking warning rather than dropping/recreating the extension on a live project.
