# Handoff

## Last updated
2026-07-10 by Claude - Intelligent PT generation: Pillar A core DEPLOYED, plus three post-test fixes: (1) bespoke movement-pattern variety + create-missing; (2) fixed the bespoke-journey timeout (parallel phase builds + skip barbell 1RM phases for bodyweight); (3) ONE smart document upload that classifies + routes (workout to reproduce, client info to the brain) via new classify-document. All deployed; build passes.

## Last code fix commit
1d1b54c - PT gen: one smart document upload that routes to the right pathway

## What just happened (read first)

### Intelligent PT generation - Pillar A + post-test enhancements (2026-07-10, Claude)

Full source-of-truth: `docs/pt-intelligent-generation/README.md`. Pillar A core is DEPLOYED
(all 7 edge functions, ref otcnrkfvgyvwolironoz): the generator reads client documents and
honors the coach's typed request; bodyweight/home/one-off requests build BESPOKE workouts
(model-built, not the canned Big-5 template) and the validator lets them publish. Two
enhancements after Pedro's first test:
- Bespoke workouts now enforce movement-pattern coverage (hinge, squat, H/V push, H/V pull,
  core) + variety, and create missing pattern exercises so variety is not capped by the
  library (programme-synthesis-agent, deployed, commit 939bb5f).
- Wizard Step 1 can REPRODUCE an exact workout from an uploaded PDF or pasted text via
  build-workout-from-text (parses, links library, creates missing), landing in the Step 3
  editor - it does not run the 3-AI generator (commit 2ab6990, frontend live on push).
Remaining: A4 (phase linkage + total kg/week), Pillar B (unified entry point), C (self-improving loop).



### PT programme board card containment (2026-07-10, LATEST)

Pedro shared a screenshot of the board view under programme editing where exercise
cards visually overflowed their day columns and overlapped adjacent days.

Shipped in code commit `129a294`:
- Updated the board view in `app/dashboard/pt/programmes/[id]/edit/PTProgrammeEditView.tsx`.
- Applied the same containment rules to `app/dashboard/pt/programmes/new/PTProgrammeWizard.tsx`
  and `app/dashboard/pt/programmes/template/[id]/edit/PTProgrammeTemplateEditView.tsx`.
- Board grids now use horizontally scrollable, minimum-width day columns.
- Day columns, bands, and exercise cards now have explicit `min-w-0` /
  `max-w-full` / `w-full` containment.
- Long exercise names use `overflow-wrap:anywhere`; movement/load chips truncate
  within the card instead of forcing card width.
- Autocomplete rows inside board edit mode now truncate safely too.

Verification:
- Next.js version is `16.2.10`, which passes the UI skill security gate.
- `npx tsc --noEmit` passes.
- `npm run build` passes. Existing warning only: Next.js middleware convention is
  deprecated in favour of proxy.

Note: `supabase/functions/programme-synthesis-agent/index.ts` was already modified
before this fix and was intentionally left untouched.

### Intelligent PT programme generation - Pillar A1 (2026-07-10)

Big multi-session project. Plan file: `~/.claude/plans/ok-we-need-to-squishy-honey.md`.
Root cause of "AI ignores my request + never reads my docs": the generator is a fixed
periodization factory - `intake_text` reaches only 2 of 6 agents then is dropped;
`programme-synthesis-agent` returns a hardcoded Big-5 template BEFORE its LLM prompt runs
(dead code); the validator hard-fails anything non-standard; the client-profile uploader
never extracted document text. Three pillars planned (A smart generation → B unified
conversational entry point → C self-improving learning loop). Task board items #1-8.

**A1 shipped in `c4f1995` (code complete, typechecked, pushed):**
- `app/dashboard/pt/clients/[id]/PTClientDetail.tsx` `handleUpload`: extracts text
  (PDF → `/api/pt/parse-pdf`, `.txt/.md` direct) and calls `ingest-client-intake`, plus a
  doc-type selector. Live on push (Vercel).
- `client-analysis-agent` + `movement-analysis-agent`: doc query now
  `order(created_at desc).limit(12)` + movement_assessment floated first.
- `movement-analysis-agent`: emits `physio_brief` (returned in response; CONSUMED in A2).

**DEPLOYED 2026-07-10:** all 7 changed edge functions (client-analysis-agent,
movement-analysis-agent, exercise-intelligence-agent, methodology-plan-agent,
programme-synthesis-agent, programme-validation-agent, pt-programme-orchestrator) were
deployed to ref `otcnrkfvgyvwolironoz` via `supabase functions deploy` (all verify_jwt=false
per config.toml). Smoke test passed (OPTIONS 200, orchestrator responds). No drift.

**A2/A3/A5 shipped** (commits 12076a6, 3f0b246, 6b7b276): coach_directive + structured
constraints + physio_brief now thread through exercise-intelligence, methodology, synthesis,
and validation. Synthesis skips the hardcoded Big-5 template in BESPOKE mode (bodyweight /
home / minimal-equipment / one-off, detected from constraints.equipment, intent, or directive
keywords) and lets the model build the requested workout; the validator demotes template rules
to non-blocking findings so it publishes. Standard clients are structurally unchanged.

**Full source-of-truth:** `docs/pt-intelligent-generation/README.md`. Remaining: A4 (phase
linkage via prior_phase_summary + total kg/week loads), Pillar B (one unified entry point:
client -> auto-show docs -> text box -> intent detect + clarifying questions -> journey or
one-off via build-workout-from-text), Pillar C (self-improving loop off pt_events + brain).

**To verify end-to-end:** open the programme wizard on a client, type a bespoke request in the
brain dump (e.g. "bodyweight, at home, no weights, focus hips, 6 exercises"), generate, and
confirm Foundation comes back bodyweight + hip-focused + ~6 exercises with no barbells, and
that validation shows only "[bespoke, non-blocking]" findings.



### Client workout journey and nutrition loading polish (2026-07-09)

Pedro shared screenshots from the client app:
- The week list inside the workout journey had an unnecessary card-like
  background behind Week 1/2/3 and future phase week lists.
- The active Week 1 marker was too large and did not read as pulsing.
- Nutrition programme creation got stuck visually at `94%`, which was misleading
  because the number was simulated, not real backend progress.

Shipped in code commit `1908a2a`:
- Updated `app/client/ClientPortal.tsx`.
- Removed the bordered/rounded/background wrapper from `renderWeekRail()` so
  weeks sit directly on the journey rail for current and future phases.
- Reduced week marker size and softened the active pulse.
- Removed the fake `nutritionCreationProgress` state, interval, percentage ring,
  and artificial 550ms success pause.
- Nutrition loading now uses an indeterminate moving ring, simple active step
  labels, and copy that says the screen will move on when saving finishes.

Verification:
- Next.js version is `16.2.10`, which is outside the vulnerable ranges listed in
  the UI design skill gate.
- `npx tsc --noEmit` passes.
- `npm run build` passes. Existing warning only: Next.js middleware convention is
  deprecated in favour of proxy.
- `npx eslint app/client/ClientPortal.tsx` is still blocked by pre-existing
  React compiler lint in the load-progress effect plus existing unused warnings;
  the removed nutrition-progress effect is no longer present.

### PT programme week advance, global session edits, and exercise search (2026-07-09)

Pedro asked for three connected PT workflow fixes:
- On the client profile under Programmes, move the active client programme one
  week forward manually, e.g. Hypertrophy week 7 to week 8.
- In PT Sessions, delete an exercise while tracking and have that change persist
  globally to the client's active programme for next time.
- Improve exercise search so word variants such as `inclined` find `incline`,
  without adding an insecure dependency.

Shipped in code commit `627c1bb`:
- Added shared programme cursor helpers in `utils/pt/programme.ts`:
  `getNextProgrammeCursor()`, `getPhaseProgressFromCursor()`, and cursor-aware
  `getCursorUpdateAfterWorkout()`.
- Client profile active programme rows now show current phase/block/week and an
  `Advance 1 week` button. The button updates
  `pt_program_assignments.current_phase_index/current_block_index/current_week`
  and writes a `programme_position_changed` event.
- Client portal and PT Sessions now respect the stored assignment cursor for the
  active phase, so a manual advance changes the block/week-specific prescription
  immediately instead of being pulled backward by older incomplete logs.
- PT Sessions now has a trash icon per exercise. Deleted exercises are hidden
  during the session with an undo chip, excluded from set logs, and removed from
  `pt_program_assignments.programme` on `Finish Session`.
- Existing PT Session swaps still persist, and set-count changes from Add/Remove
  set now persist into the active programme too. For block-based programmes this
  writes an exercise `week_overrides` entry for the current block; otherwise it
  updates the exercise `sets`.
- Programme edits are saved before booking/session credit deduction, preserving
  the existing Finish Session ordering rule.
- Added `utils/pt/exercise-search.ts`: local token scoring with normalization,
  suffix variants (`inclined` -> `incline`), partial matching, typo tolerance,
  and weighted fields. Wired into PT Sessions swap search, programme editors,
  exercise manager, related exercise picker, and PT settings exercise search.
- No new npm search package was added. GitHub research reviewed Fuse.js,
  MiniSearch, and FlexSearch patterns, then used a local implementation to avoid
  new supply-chain surface.

Verification:
- `npx tsc --noEmit` passes.
- `npx eslint utils/pt/exercise-search.ts utils/pt/programme.ts` passes.
- `npm run build` passes. Existing warning only: Next.js middleware convention is
  deprecated in favour of proxy.
- Targeted lint on large app files is still blocked by pre-existing React
  compiler / lint issues in `ClientPortal.tsx`, `PTSessionsView.tsx`,
  `PTClientDetail.tsx`, and programme editor files (`set-state-in-effect`,
  purity, unused vars, unescaped text). These are not introduced by this change.

### Client Settings logout button (2026-07-09, LATEST)

Pedro asked for another logout button in the client app Settings tab.

- Updated `app/client/SettingsTab.tsx`.
- Added a bottom `Session` section with signed-in email and a `LogOut` icon
  button.
- Button calls `supabase.auth.signOut()` and redirects to `/client-login`,
  matching the existing header sign-out behavior.
- Added disabled state while signing out and inline error feedback if Supabase
  sign-out fails.
- Validation passed: `npm run lint -- app/client/SettingsTab.tsx`,
  `npx tsc --noEmit`, and `npm run build`.

### Studio portrait export reference match (2026-07-09, LATEST)

Pedro supplied a reference where the social portrait video is a hard split:
screen recording full-bleed on the top half, speaker camera full-bleed on the
bottom half. Studio's portrait export was still drawing the screen as a rounded
card with margins and a gap, leaving black space around the top screen.

- Updated `app/dashboard/studio/layouts.ts` only.
- `drawPortraitStacked()` now uses a 50/50 vertical split:
  - top `0..50%`: screen capture, full width, cover-cropped with slight overscan.
  - bottom `50..100%`: camera video, full width, cover-cropped.
- Landscape recording and camera-bubble layouts were not changed.
- Validation passed: `npm run lint -- app/dashboard/studio/layouts.ts`,
  `npx tsc --noEmit`, and `npm run build`.

### Next-Meal: "My meals" (recipe book + history tab) (2026-07-08, LATEST)

Pedro asked to see past searches and save a meal from them, and to rename the
recipe book to something that holds both history and saved recipes.

- **Rename:** "Recipe book" → **"My meals"**. `RecipeBookModal.tsx` deleted,
  replaced by `app/client/MyMealsModal.tsx` with two tabs:
  - **Saved** = the recipe book (search / meal-type filter / expand / "I made
    this" / Remove) - same as before.
  - **Recent** = the last 3 `next_meal_sessions`, grouped by search (meal type ·
    time · craving), each showing its generated meals. Any past meal has **Save**
    (→ recipes, deduped against already-saved via a `savedNames` set) and
    **"I made this"** (→ pt_nutrition_logs).
- **Schema:** migration `next_meal_sessions_store_meals` adds a `meals` jsonb
  column. `NextMealModal.generate()` now stores the full `meals` array on the
  session (previously only meal_type/ingredients/craving), so history is
  revisitable and savable.
- NutritionTab: the entry button is now "My meals" (`showMyMeals`).
- **Bug fixed:** `savedNames` did `r.name.toLowerCase()` and could crash on an
  undefined name; guarded with `(r.name ?? '')`. (Surfaced via the probe; the DB
  column is NOT NULL so production was safe, but the guard is correct.)

Verified via throwaway probe + Playwright at 390px (network stubbed): both tabs,
Recent shows grouped searches, and **saving a past meal from Recent moves it into
Saved** (Saved count 1 → 2, dedup shows already-saved as "Saved"). tsc + build pass.

### Next-Meal Phase 3: recipe book + session memory (2026-07-08)

Source of truth: `docs/next-meal/README.md` (all 3 phases now shipped).

Final phase of "Help me with my next meal":
- Migration `next_meal_recipe_book` (applied): `recipes` and `next_meal_sessions`
  tables + RLS. RLS mirrors `pt_nutrition_logs` exactly: admin-full (Pedro emails
  or profiles.role='admin') + client owns own (insert/read/delete;
  next_meal_sessions also update). Confirmed pt_nutrition_logs already has a
  `client_insert_own` policy, so Phase 2's "I made this" works for real clients.
- `NextMealModal`: **Save** bookmark on each option card → insert into `recipes`
  (source `generated`), idempotent per session (savedNames set + filled state).
  Each generation inserts a `next_meal_sessions` row (meal_type, ingredients,
  craving); `chosen_option` set on log/save.
- `app/client/RecipeBookModal.tsx` (new): full-screen recipe book opened from a
  "Recipe book" button under the two nutrition actions. Loads the client's
  recipes, search (name/desc/ingredient), meal-type filter chips, expandable
  cards, "I made this" → pt_nutrition_logs (refreshes tracker), "Remove" → delete,
  friendly empty state with a "Find a meal" button.

Verified via throwaway probe + Playwright at 390px (getUserMedia + network calls
stubbed): full flow incl. Save bookmark toggling to saved, and the Recipe Book
(3 saved, search filters to "yoghurt", Breakfast filter shows only the omelette,
expand shows ingredients/steps, I-made-this/Remove render). tsc + build pass.

NEXT: nothing required to ship - feature-complete. Outstanding: a real-device
pass on Pedro's phone (iOS getUserMedia + live models as the actual client) and an
allergy spot-check. Optional v2 ideas in docs/next-meal/README.md §8.

### Next-Meal Phase 2: generation + logging (2026-07-07)

Source of truth: `docs/next-meal/README.md` (updated - Phases 1 & 2 now shipped).

Built the generation half of "Help me with my next meal":
- `supabase/functions/suggest-next-meal/index.ts` (deployed, verify_jwt on,
  admin-OR-owner auth). Loads `daily_targets`, sums today's `pt_nutrition_logs`
  into a **remaining** budget, reads goal + `foods_to_avoid` + last 3 days of
  meals, detects **full_day vs gap_fill** mode (full_day = nothing logged yet →
  size as one meal + teach the leftover; gap_fill = fit the remainder), and
  returns N meals `{name, description, whyThisOne, prepTimeMinutes, calories,
  protein, carbs, fat, ingredients[], steps[]}` + a `context` (mode + remaining).
  Discovery + craving modes, substitution honesty.
- `NextMealModal` options step: context banner (mode-aware remaining), 5 cards
  (macros, prep, "why this one"), tap-to-expand recipe (ingredients + steps),
  **"I made this"** → direct insert into `pt_nutrition_logs` (input_type `text`)
  → `onLogged` refreshes NutritionTab → logged-success screen; **"Swap"**
  (single-card regen, count:1 + exclude); **craving re-ask** ("New options").
  The old interim "coming soon" screen is gone; "Find meals" now generates.

Verified end to end via a throwaway probe + Playwright at 390px (getUserMedia,
detect, suggest, and the log insert all stubbed): meal type → camera (2 shots) →
analyze → confirm → Find meals → 5 option cards → expand recipe → "I made this" →
"Logged to your tracker". tsc + build pass. Real client-session pass on Pedro's
phone is still the outstanding test.

NEXT: Phase 3 - `recipes` table + Recipe Book tab (save/search/filter/remove) +
generation-session memory. Spec in docs/next-meal/README.md §8.

### Weekly Tonnage Phase 1: exercise library classification foundation (2026-07-07)

Pedro provided `Cerebro Knowledge/weekly-tonnage-prd.md`. The PRD says to ship
phases sequentially, so only Phase 1 was built: "classify once, compute forever."

Shipped in commit `670c0a2`:
- Added `public.exercise_library` for deterministic tonnage tags, separate from
  `pt_exercises` video/programming cards.
- Columns include canonical name/key, aliases, pattern, plane, primary muscle,
  secondary muscles, load type, bodyweight factor, tonnage mode, confidence,
  locked, and needs-review fields.
- RLS is enabled. `service_role` has full access; authenticated access is
  restricted to Pedro/admins. Supabase advisors were clean for this new table
  after wrapping the JWT call in the admin policy.
- Added deployed edge function `classify-exercise-library`.
  - Inputs: `workout_log_id`, explicit `exercise_names`, or admin-only
    `backfill`.
  - Exact/alias matches are skipped.
  - AI classifies only missing exercises.
  - Low confidence or AI failure inserts `pattern='other'` with
    `needs_review=true`, so workout saving and future computation are not
    blocked by AI.
  - Backfill paginates set logs and persists each model batch immediately.
- Client self-logging and coach PT Sessions now call the classifier
  fire-and-forget after workout logs, set logs, and workout event insertion.
  Workout completion remains successful even if classification fails later.
- Workout event metadata now includes `workout_log_id`.

Live deployment/backfill:
- `supabase db push` is blocked by existing remote/local migration drift, so this
  migration SQL was applied directly with
  `supabase db query --linked -f supabase/migrations/20260707052129_weekly_tonnage_exercise_library.sql`.
- Deployed `classify-exercise-library` to project `otcnrkfvgyvwolironoz`.
- Smoke test classified:
  - Bench Press -> Push / Horizontal / Chest / external.
  - Pull-Up -> Pull / Vertical / Back / bodyweight factor 1.0.
- Historical backfill completed. Final coverage query found `0` missing logged
  exercise names after alias matching.
- Current live `exercise_library` count: `164` rows, `34` needs-review rows.
  Review rows are mostly mobility/control drills and compound names, e.g.
  `90-90 Breathing`, `Thread the Needle`, `Spider-Man lunge`,
  `DB Lateral Raise, Bicep Curl, Skull Crusher`.

Verification:
- `npx eslint supabase/functions/classify-exercise-library/index.ts` passes.
- `npx tsc --noEmit` passes.
- `npm run build` passes on Next.js 16.2.10. Existing warning only:
  middleware file convention is deprecated in favour of proxy.
- Targeted ESLint on `ClientPortal.tsx` and `PTSessionsView.tsx` still fails on
  pre-existing React compiler `set-state-in-effect` errors in those large files;
  the new classifier hook lines are not the failing lines.
- `supabase db lint` could not run because local Postgres at `127.0.0.1:54322`
  is not running. Linked advisors were run instead.

NEXT:
1. Phase 2: create `weekly_tonnage`, deterministic tonnage computation, and
   full-week recompute after workout completion.
2. Use `exercise_library.tonnage_mode` to exclude carry/isometric/time-based
   exercises from v1 totals and list them as "not included" later.
3. Use latest `pt_client_metrics.weight_kg`, then `pt_clients.current_weight_kg`
   for bodyweight exercises.
4. Phase 3: client home card/drilldown and coach review screen for
   `needs_review` rows. Saving a coach edit must set `locked=true` and never be
   reclassified.

### Movement Screening: frame-clocked live camera and overlay (2026-07-07, LATEST)

Pedro confirmed the Studio latency fix worked and asked to apply the same idea
to the Movement Screening camera and the live video/overlay people see while
doing the test.

Shipped in commit `56e5b39`:
- The live pose loop no longer depends on `requestAnimationFrame` as the primary
  clock. It now submits camera frames from
  `HTMLVideoElement.requestVideoFrameCallback()` when the browser supports it,
  so pose extraction follows the real delivered camera frames.
- Added a dedicated Movement Screening worker heartbeat at 30fps. It only nudges
  inference if the video-frame callback stalls or if the browser lacks
  `requestVideoFrameCallback`.
- Preserved the existing one-frame-in-flight pose-worker rule. If the worker is
  busy, frames are dropped and counted instead of queueing stale frames.
- The transparent pose overlay canvas now requests `{ desynchronized: true }`.
  It does not force `alpha: false` because this canvas sits over the camera
  preview and must remain transparent.
- Local calibration recording now prefers lower-cost formats before VP9:
  WebM/H264 when exposed, then VP8, then VP9, then generic WebM, then MP4
  fallbacks for iPhone/WebKit.
- No metrics, rule thresholds, findings, or Phase 1 scope were changed.

Docs in commit `83d369d`:
- Phone capture guide now asks Pedro to check that green landmarks follow the
  body smoothly without visible delay.
- Phase 1 checklist records the new video-frame-clocked camera path and keeps
  the iPhone acceptance gate locked to three real technical trials.

Verification:
- `npm run test:movement-screening` passes: 24/24.
- Targeted ESLint passes for changed movement-screening files.
- `npx tsc --noEmit` passes.
- `npm run build` passes on Next.js 16.2.10. Existing warning only:
  middleware file convention is deprecated in favour of proxy.

NEXT:
1. Pedro fully reloads `https://cerebroai.au/dashboard/pt/movement-screening`
   on iPhone 16 Pro Chrome after deployment.
2. Confirm the camera fills the green card with no large black bars.
3. Move slowly and confirm the green landmarks feel attached to the body, not
   delayed or choppy.
4. Confirm the one-phrase top cue is still readable at distance.
5. Run the three iPhone technical trials from
   `docs/movement-screening/PHONE-CAPTURE-TEST-GUIDE.md`.
6. Do not unlock movement ordering, calibration-rule changes, commentary, report,
   or self-learning workflow until those three trials pass.

### Next-Meal Phase 1: auth fix + in-app camera + confirm cards (2026-07-07)

**Full feature doc (what/why/how, 3-phase roadmap, data model, what's next):**
`docs/next-meal/README.md` - read that first for the big + small picture; the
entries below are the change log.

Pedro tested Phase 1 on his phone. Three issues, all fixed:

1. **"Couldn't read those photos" was a lie.** The photos were fine; the analyze
   call was returning **404** = my `detect-fridge-ingredients` "Client not found"
   branch. Root cause: the function gated on `pt_clients.user_id = auth.uid`
   (owner-only), but Pedro tests from an account that isn't the linked client
   login (client `e8def647` / pedro@pedept.com.au is linked to auth `637726dd`;
   he was on a different login). The whole client portal uses this same strict
   gate, so the feature works when logged in AS the client, but not otherwise.
   Fix: adopt the codebase's real pattern from `generate-nutrition-programme` -
   authorize if **coach/admin (PEDRO_EMAILS or profiles.role='admin') OR owning
   client**. Detection returns no client-private data, so this is safe. Also made
   auth/parse failures return HTTP 200 `{ok:false,error}` so the real reason
   surfaces, and the client no longer hard-codes a photo-quality message.
   detect-fridge-ingredients redeployed (v2, verify_jwt on).

2. **Multi-shot camera.** The native `<input capture>` forces take -> "Use Photo"
   -> reopen per shot. Replaced with an in-app camera (getUserMedia live preview
   + shutter, pattern mirrors ML-assessment/Studio): snap many in a row, running
   thumbnails + count, Done to finish. Falls back to native input if getUserMedia
   is unavailable/denied. Photo cap raised 5 -> 10 (client + function).

3. **Yes/No confirmation cards.** Low-confidence detections now appear in a
   "Just checking" section as `Do you have X? [Yes][No]` cards; Yes moves the item
   into the confirmed chips, No removes it. High-confidence items skip straight to
   chips.

Verification (throwaway probe + Playwright at 390px, deleted after): capture step,
in-app camera overlay (shutter captured 3 shots, 3/10 count, thumbnails, Done),
and confirm step with the two yes/no cards + working Yes(->chip)/No(->removed)
were all visually confirmed. tsc + build pass. Real iOS-Safari camera behaviour
still needs Pedro's phone (getUserMedia on iOS is the true test).

### Cerebro Studio: local recording latency reduction (2026-07-07)

Pedro reported the Studio camera looked laggy/choppy during screen + camera
recording, like a bad connection. Internet is not involved: Studio captures,
composites, and records locally in the browser.

Research / implementation direction used:
- Mature browser recorders such as Screenity avoid depending on foreground-tab
  rendering alone and eventually move heavy pipelines to Offscreen/WebCodecs.
- `HTMLVideoElement.requestVideoFrameCallback()` is the correct browser clock
  for drawing a video source to canvas when a new media frame is available.
- Canvas 2D contexts can request `{ alpha: false, desynchronized: true }` to
  avoid unnecessary alpha blending and reduce latency where the browser honours
  it.
- Feeding a 4K/retina screen into a 1080 output canvas makes the main thread and
  MediaRecorder work harder than needed.

What changed in commit `fd556c3`:
- Studio already had the Web Worker tick from the previous fix. This pass kept
  it, but changed its role to a background-safe stall heartbeat instead of the
  primary drawing clock.
- The compositor now uses `requestVideoFrameCallback()` on the camera and screen
  `<video>` elements, so canvas draws follow actual delivered media frames.
- The worker still ticks at 30fps and forces a draw only if video-frame callbacks
  stall, which protects recording when Chrome throttles foreground rendering.
- Both landscape and portrait canvases request a 2D context with
  `{ alpha: false, desynchronized: true }`.
- Camera capture and screen capture now request max `1920 × 1080` at `30fps`.
  This prevents a 4K/retina display or camera from being downscaled every frame
  into the 1080p output canvas.
- MediaRecorder now prefers cheaper/lower-latency codecs before VP9:
  WebM/H264 if Chrome exposes it, then VP8, then VP9, then browser default WebM.
- Studio logs recording/compositor diagnostics to the browser console:
  selected recorder MIME type, track dimensions/FPS, draw FPS, camera-frame FPS,
  screen-frame FPS, worker tick FPS, skipped draws, and whether the document is
  hidden.

Verification:
- Targeted ESLint passes for changed Studio files.
- `npx tsc --noEmit` passes.
- `npm run build` passes on Next.js 16.2.10. Existing warning only:
  middleware file convention is deprecated in favour of proxy.

NEXT:
1. Pedro reloads `/dashboard/studio`.
2. Open Chrome DevTools console before recording.
3. Record a 20-30 second screen + camera take while clicking around another app
   or tab.
4. Check whether the final video camera motion is live/crisp and whether audio
   remains in sync.
5. If lag remains, copy the `[Studio compositor]` and `[Studio recorder]` console
   logs into the next message. If draw/camera FPS are healthy but the saved file
   is still choppy, the next step is a separate WebCodecs/OffscreenCanvas
   migration proposal rather than another small MediaRecorder tweak.

### Client Nutrition: "Help me with my next meal" Phase 1 (2026-07-07)

New client feature (PRD: Google Doc "Help Me With My Next Meal"). Lets a client
photograph their fridge/pantry and get meal ideas that fit their remaining daily
macros. Being built in 3 phases; **Phase 1 (detection + confirmation) shipped**.

What's live in Phase 1:
- `app/client/NutritionTab.tsx` entry point: the single "Track your food" button
  is now TWO equal-weight actions - "Track your food" (existing logger) and
  "Help me with my next meal" (new flow). Opens `NextMealModal`.
- `app/client/NextMealModal.tsx` (new): full-screen flow - meal-type
  (breakfast/lunch/dinner/snack) -> photo capture (1-5, deletable thumbnails,
  compress to 1280px jpeg base64, mirrors NutritionChatModal) -> analyzing ->
  confirmation (category-grouped removable chips, add-via-text with a small
  hardcoded autocomplete, "I have basic staples" toggle default ON, optional
  craving field with iOS-safe voice-to-text).
- `supabase/functions/detect-fridge-ingredients/index.ts` (new, DEPLOYED v1,
  verify_jwt on): reuses the log-nutrition-batch Claude-vision + auth + CORS
  pattern (model claude-sonnet-4-6). Verifies pt_clients.user_id ownership.
  Returns strict `{ ok, ingredients: [{ name, category, confidence }] }`.
  Smoke-tested live: POST unauth -> 401, OPTIONS -> 200.

Phase 1 end state is an honest interim: the confirm CTA "Find meals" goes to a
"got your ingredients / suggestions coming shortly" screen. Generation is Phase 2.

**Data the AI already has (no new tables needed until Phase 3):** targets in
`pt_client_nutrition_doc.daily_targets`; logged intake in `pt_nutrition_logs`
(remaining = target - today's sum); allergies/dislikes in
`pt_client_nutrition_doc.foods_to_avoid`; goal in `pt_clients.goals`.

Decisions locked with Pedro:
- First-meal-of-day mode = "full remaining + teach": when nothing is logged yet,
  show the whole day's budget as context and have the AI pick a sensible single
  meal portion + explain the leftover (shapes the Phase 2 generation prompt).

Verification: tsc clean; `npm run build` passes (exit 0); new component lint
clean except the unavoidable `<img>` blob-preview warning (same as
NutritionChatModal). mealType + capture screens visually verified at 390px via a
throwaway probe (deleted). NOT yet exercised end-to-end as a logged-in client -
the photo->detect->confirm loop needs a real client session; Pedro should run it
once on his phone.

NEXT (Phase 2): generation edge function (context payload: targets + remaining +
foods_to_avoid + recent meals + full-day-vs-gap-fill mode) -> 5 option cards ->
"I made this" logs into pt_nutrition_logs -> single-card regen. Then Phase 3:
`recipes` table + Recipe Book + session memory.
NOTE: the "Help me with my next meal" button is live in the client portal; if
Pedro doesn't want clients seeing an in-progress feature, gate/hide that button
until Phase 2 (one-line change in NutritionTab).

### Movement Screening: filled iPhone capture HUD (2026-07-07)

Pedro tested the widened camera build on iPhone and supplied screenshots showing:

- iPhone Chrome returned a `1280 × 960` 4:3 camera stream.
- Rendering that stream with `object-contain` inside the tall capture card left
  large black bars above and below the video.
- The central black instruction card blocked his head/body, which made it hard
  to position himself while away from the phone.
- A quality-check failure occurred while he was close to the phone / not fully
  framed; the UI needed to guide the subject better before trial start.

Shipped in commit `1bc0203`:

- Camera constraints now explicitly prefer the iPhone's observed 4:3
  full-sensor stream (`1280 × 960`) for both portrait and landscape screen
  orientations.
- The phone camera HUD now uses a taller `70svh` capture card and renders the
  video/canvas with `object-cover`, filling the green frame and cropping side
  overflow instead of showing black bars.
- The visible green capture guide was expanded slightly to use more of the card.
- The large centre instruction panel was replaced with a compact top-positioned
  cue HUD.
- Cues are now short one-phrase states designed for hands-free navigation:
  `Step back`, `Arms forward`, `Hold still`, `Freeze`, `Squat 1 of 3`,
  `Stand tall`, `Redo needed`.
- The bottom overlay is smaller so it interferes less with feet/ankles.
- Phone test guide and Phase 1 checklist now describe the intended filled
  4:3-crop behaviour and ask Pedro to stay centred.

Verification:

- `npm run test:movement-screening` passes: 24/24.
- Targeted ESLint passes for changed movement-screening files.
- `npx tsc --noEmit` passes.
- `npm run build` passes on Next.js 16.2.10. Existing warning only:
  middleware file convention is deprecated in favour of proxy.

NEXT:

1. Pedro fully reloads `https://cerebroai.au/dashboard/pt/movement-screening`
   on iPhone 16 Pro Chrome after deployment.
2. Confirm the camera feed fills the green capture card with no large black
   bars. Side cropping is expected; Pedro should stay centred.
3. Confirm the one-phrase top cue is readable at distance and no longer blocks
   his head/body.
4. Run the start gate: `Step back` -> `Arms forward` -> `Hold still`.
5. Complete one slow three-rep bodyweight-squat trial and report whether the
   quality check passes or which rejection reason appears.
6. Keep movement ordering/calibration/later learning workflow locked until three
   real iPhone technical trials pass.

### Cerebro Studio: clean portrait export + lower-latency mic (2026-07-07)

Pedro tested Studio and supplied screenshots showing:

- Final review/export included the extra floating self-view inside the captured
  screen area.
- The portrait export had a black border around the top screen-recording card.
- His voice felt lagged against the video.

Shipped in commit `cc9539e`:

- Floating self-view is now setup-only. Studio closes it when the countdown
  starts and again before MediaRecorder starts. The control is hidden during
  recording.
- Reason: with "Entire Screen" capture, any floating OS/browser window visible
  on that monitor becomes part of the screen pixels. Browser code cannot
  subtract it from the screen stream after capture. Closing it before recording
  is the clean-export-safe behaviour.
- Portrait export now draws the screen card with `cover` plus 1.1x overscan
  instead of `contain`, so it zooms in enough to remove the black border around
  the shared screen card.
- Mic-only recordings now add the original microphone track directly to the
  landscape and portrait recorder streams. Web Audio mixing is used only when
  system audio is actually being mixed in. This removes the avoidable
  MediaStreamDestination/Web Audio latency in the default mic-only path.
- Updated the camera-switch comment so future edits preserve the direct-mic
  default and use Web Audio only for system-audio mixing.

Verification:

- Targeted ESLint passes for changed Studio files.
- `npx tsc --noEmit` passes.
- `npm run build` passes on Next.js 16.2.10. Existing warning only:
  middleware file convention is deprecated in favour of proxy.

NEXT:

1. Pedro reloads `/dashboard/studio` after deployment.
2. Record a short desktop screen + camera test with portrait export on.
3. Confirm the portrait top screen card no longer shows the black border.
4. Confirm the final export no longer includes the extra floating self-view.
5. Confirm voice/video sync is materially tighter. If still lagging, next
   likely layer is compositor/canvas timing rather than Web Audio mixing.

### Movement Screening: wide camera preview (2026-07-07)

Pedro reported the iPhone movement-screening camera looked zoomed in, forcing him
to step so far back that the on-screen instructions became unreadable.

Root cause addressed in commit `75c7511`:

- The phone preview used a tall 9:16 viewfinder and `object-cover`, which can
  crop the live video and look like camera zoom.
- The camera constraints also asked for a 9:16 portrait stream, which can
  encourage the browser to crop/scale the camera feed instead of using the
  wider sensor mode.

Fix:

- `createFrontCameraConstraints()` now requests a fuller sensor shape:
  3:4 in portrait and 4:3 in landscape.
- It requests `resizeMode: none` where supported, so the browser should avoid
  crop-and-scale when choosing a camera mode.
- After the stream opens, the app calls `requestMinimumCameraZoom()` and applies
  the track's minimum zoom if the browser exposes zoom capabilities.
- The live `<video>` and pose `<canvas>` now render with `object-contain` on
  phone and desktop, so CSS no longer crops the camera feed.
- The camera card changed from 9:16 to 3:4 on phones and 4:3 on desktop, keeping
  the visible green guide aligned with the wider capture request.
- Phone test guide and Phase 1 checklist now explicitly require a non-cropped
  preview/FOV confirmation before the three technical trials.

Verification:

- `npm run test:movement-screening` passes: 24/24.
- Targeted ESLint passes for the changed movement-screening files.
- `npx tsc --noEmit` passes.
- `npm run build` passes on Next.js 16.2.10. Existing warning only:
  middleware file convention is deprecated in favour of proxy.

NEXT:

1. Pedro fully reloads `https://cerebroai.au/dashboard/pt/movement-screening`
   on iPhone 16 Pro Chrome after deployment.
2. Confirm the preview looks wider/non-cropped and no longer artificially
   zoomed in.
3. Confirm `Bodyweight squat`, rules v2, arms-forward auto-start, and
   arms-forward auto-save still work.
4. Complete the three ordinary iPhone technical trials from
   `docs/movement-screening/PHONE-CAPTURE-TEST-GUIDE.md`.
5. Keep movement ordering, calibration, and the proposed five-edit learning
   workflow locked until these real-device trials pass.

### PT Bookings: white CTA fix + mobile booking (2026-07-06)

Pedro reported the black CTA buttons on `/dashboard/pt/bookings` (Book session,
Add pack, Add availability, and the modal Book / Mark done / Approve) rendering
as blank white pills, and asked to make the page bookable from his phone.

Root cause of the white-on-white buttons: the panel-glass rule in
`app/globals.css`, `.liquid-dashboard main [class*="bg-white"]` (specificity
0,2,1), **substring**-matches the `hover:bg-white` utility on those CTAs and
paints them with `--liquid-glass` (translucent white). That out-specifies
`.liquid-dashboard .bg-black` (0,2,0) for the background, while `.text-white`
keeps the label white -> white text on a white surface. Same substring-vs-token
class as learning-log Entry 058.

Fix (globals.css, added right after the `.bg-black *` block):
`.liquid-dashboard main button[class~="bg-black"]` / `a[class~="bg-black"]`
(+ `.client-liquid` equivalents) re-assert `#080808` bg + white text at
specificity (0,2,2). That beats the glass rule at rest but sits below the
desktop hover-invert rule `main button:hover[class*="hover:bg-white"]` (0,3,2),
so hover-to-white still works on desktop and buttons stay solid on touch. This
is a **site-wide** fix - every dashboard/client black CTA that also carries
`hover:bg-white` is corrected, not just bookings.

Mobile (`PTBookingsView.tsx`):
- New mount effect: on `matchMedia('(max-width: 640px)')` the calendar starts in
  `day` view (the 5-col week grid is `min-w-[48rem]` inside `overflow-x-auto`, so
  week needs horizontal scroll on a phone; day view fits and keeps green slots
  tappable -> tap slot -> booking modal). Only runs once on mount, so Pedro can
  still switch to week/month manually.
- Metric tiles now `grid-cols-2` on mobile (was 1-up) for a compact 2x2.

Verification:
- Cascade proven against the REAL compiled globals.css via a throwaway public
  `/cssprobe` page + Playwright at 390px: the buggy CTA computed to
  `background rgb(8,8,8)` / `color rgb(255,255,255)` (solid black, visible white
  label); a real `bg-white` secondary button still got `rgba(255,255,255,0.46)`
  glass + dark text (untouched). Probe deleted afterwards.
- `npm run build` passes clean (exit 0, "Compiled successfully").
- NOT yet visually verified on the live phone against production - Pedro should
  eyeball `/dashboard/pt/bookings` on his iPhone after this deploy.

### Movement Screening: bodyweight-squat rules v2 (2026-07-05)

Pedro simplified the current technical test from an overhead squat to a
front-view bodyweight squat before movement ordering or calibration work.

Shipped in commit `672075d`:

- The distance-readable camera guide now names `Bodyweight squat`, front view,
  and three repetitions.
- Full-body framing alone no longer starts the test. Pedro must stand tall with
  both arms straight forward at shoulder height for three continuous seconds.
- The same arms-forward standing posture plus three seconds of stillness is
  required after rep three before the recording saves automatically.
- Dropping the ready posture, leaving the guide, or moving during the finish
  hold resets the relevant countdown.
- The overhead-only arm quality gate was removed from bodyweight-squat metrics.
  Legacy rules v1 remains readable so rollout order was safe.
- Rules/metrics/result schemas moved to 1.1.0. Immutable rules v2 is active in
  Supabase; overhead rules v1 is retained as retired history.
- The first three movement-screening skills and both test guides now use the
  bodyweight-squat contract. Later commentary/report/refinement skills remain
  locked until Phase 1 passes.

Safe rollout:

1. Compatibility code deployed while overhead rules v1 remained active.
2. Vercel deployment `dpl_9YUKdnTC3SpaBYsaxxchTLjcLfBs` became Ready and
   `cerebroai.au` resolved to it.
3. Only then was the immutable rules v2 migration applied.
4. Database verification shows exactly one active row: v2,
   `bodyweight_squat_front`, hash
   `62c7807db75597d843f8caf2a320bf27f723e0157a9d045b1c1abbd0bc757c88`.

Verification:

- 22/22 movement-screening tests pass.
- Full TypeScript, targeted ESLint, and production build pass.
- Migration JSON equals the checked-in fixture and its canonical SHA-256.
- Production route remains authenticated (307 to login when signed out),
  camera permission policy remains `camera=(self)`, and the pinned pose model
  returns 200 with immutable caching.
- `npm audit --omit=dev` reports two pre-existing high advisories through
  `@mapbox/node-pre-gyp -> tar`; this change added no dependency.

NEXT:

1. Pedro fully reloads the movement-screening route on iPhone 16 Pro Chrome.
2. Confirm rules v2 and `Bodyweight squat` appear.
3. Complete three ordinary trials using
   `docs/movement-screening/PHONE-CAPTURE-TEST-GUIDE.md`.
4. Report whether arms-forward start/finish tolerance, all three repetitions,
   automatic save, evidence export, and camera cleanup pass.
5. Do not build movement ordering, calibration, or the proposed five-edit
   self-learning checker until these three real-device trials pass.

### Cerebro Studio: floating self-view / Document PiP (2026-07-05)

Pedro confirmed the compositor fixes work ("perfect"). New ask: while recording,
when he switches to another tab/app he wants to keep seeing himself (the recorded
bubble is only visible on the Studio tab), and still switch layout / camera from
there. Built the Phase 3 Document Picture-in-Picture item (commit 2e2a3e9):

- useDocumentPip.ts (new): owns one always-on-top Document PiP window. Chrome-only
  (typed narrowly, not in lib.dom). open() needs a user gesture; closed on unmount
  and when phase -> review (camera is released then).
- SelfViewPip.tsx (new): mirrored camera view rendered via createPortal INTO the
  PiP window's document.body, so it stays in sync with app state. Inline styles
  (the PiP document has no stylesheet - deliberate exception to the Tailwind-only
  rule). Buttons: layout 1/2/3, flip camera, stop; REC dot + timer while recording.
- useHotkeys.ts: now takes an optional `target` window so 1/2/3 / Space / Esc also
  fire while the floating window is focused. IMPORTANT LIMIT: a browser tab cannot
  capture keys while a DIFFERENT app holds focus, so global hotkeys from inside
  Excel etc. are impossible; the floating window's on-screen buttons cover that.
- useMediaStreams.ts: added switchCamera() - audio-safe flip that hot-swaps ONLY
  the video track in the live stream. flipCamera routes through it now. This
  matters because mergeAudioTracks (audio.ts) builds a Web Audio source node bound
  to camMicStream; the old flip called startCamMic which STOPPED that stream and
  would have cut the recorded audio on a mid-record flip. Do not revert flip back
  to startCamMic.
- StudioApp.tsx: "Float self-view" toggle (shown when Document PiP is supported,
  non-cameraOnly, not review); portal render; second useStudioHotkeys targeting
  the PiP window.

tsc + Studio ESLint clean. NOT yet verified on hardware (Document PiP + Continuity
Camera can't be driven from the test harness) - Pedro to confirm: floating window
shows his mirrored face, its buttons switch layout/camera and stop, and a mid-record
camera flip keeps audio. Studio Phase 3 remaining after this: orientation picker,
bubble position/size pickers, review polish.



### Cerebro Studio: compositor freeze + dead space (2026-07-05, LATEST)

Pedro tested on real hardware. iPhone via Continuity Camera works and looks great,
and the portrait cut looks good. Two issues he raised, both fixed in commit
13d7e2f:

1. Tab-switch freeze (useCompositor.ts + new tick.worker.ts): switching to another
   tab/app (Excel) mid-recording showed the new content several seconds late. Root
   cause: the compositor draw loop used requestAnimationFrame, which Chrome
   throttles to ~1fps on a HIDDEN tab, so the canvas (and the MediaRecorder reading
   it) stopped updating until he switched back. Fix: a Web Worker setInterval ticks
   at 30fps regardless of tab visibility and posts to the main thread, which renders
   on each tick. rAF kept only as a fallback if Worker creation fails. Same worker
   pattern the pose pipeline uses (new URL(..., import.meta.url)). NOTE: if a future
   need arises for the Studio tab hidden 5+ min continuously, consider
   OffscreenCanvas-in-worker or MediaStreamTrackProcessor for full immunity.

2. Screen dead space (layouts.ts): landscape layouts 1 and 3 letterboxed the 16:10
   laptop screen inside the 16:9 canvas (black bars). Now drawCover fills the canvas
   edge to edge, cropping a few pixels top/bottom. Portrait card kept on drawContain
   deliberately (Pedro likes the portrait; cover there would crop spreadsheet rows).

tsc + Studio ESLint clean. NOT yet re-confirmed on hardware: Pedro to verify the tab
switch is now instant while recording and that the filled screen framing looks right
(the macOS menu bar / dock edges may be cropped by cover).

### Cerebro Studio: screen picker + phone-as-webcam (2026-07-05)

Pedro reported (1) screen recording no longer captured another Chrome tab he had
open, and (2) his laptop webcam wasn't working, so he wants to use his iPhone as the
Studio camera.

Fixed (commit 68464b4, app/dashboard/studio/useMediaStreams.ts + StudioApp.tsx):
- Root cause of (1): `getDisplayMedia` had no surface hint, so Chrome's picker
  defaulted to sharing a SINGLE tab, which only ever captures that one tab. "It
  worked at the beginning" = he first picked Entire Screen, later picked a tab.
- `startScreen` now passes `video: { displaySurface: 'monitor' }` (pre-selects
  Entire Screen), `surfaceSwitching: 'include'` (swap shared surface mid-record),
  `selfBrowserSurface: 'exclude'` (hide the Studio tab from the list). Typed via a
  local `ScreenShareOptions extends DisplayMediaStreamOptions` (those hints aren't
  in lib.dom yet). Added a UI note under Share screen: pick Entire Screen to catch
  other tabs/apps.
- tsc + Studio ESLint clean. NOT yet confirmed on real hardware; the picker is a
  native OS dialog; Pedro must verify it now defaults to Entire Screen.

Phone-as-webcam (2): Pedro chose the NO-BUILD path, macOS Continuity Camera. His
iPhone appears in Studio's existing Camera dropdown automatically (devicechange
listener refreshes the list; selecting it re-acquires via startCamMic(deviceId)).
No code needed. The in-app QR/WebRTC bridge was offered as a Phase 3 alternative
and declined for now; revisit only if he wants a cross-platform, OS-setup-free
flow later.

Follow-up commit `e1f1dd3` also refreshes the device list when the default camera
fails, so a busy/broken built-in webcam no longer leaves the dropdown empty and
blocks selection of the iPhone Continuity Camera.

NEXT:
1. Pedro: enable Continuity Camera (iPhone near, unlocked-not-required, WiFi+BT on,
   same Apple ID), then pick "iPhone Camera" in Studio's Camera dropdown. Confirm
   the feed shows in the stage preview.
2. Pedro: confirm the screen picker now defaults to Entire Screen and a mid-record
   tab switch is captured.
3. (Optional) Diagnose why the built-in laptop webcam failed; likely a Chrome
   permission or another app holding the camera (NotReadableError).

### Movement Screening hands-free capture flow (2026-07-05, LATEST)

Pedro could not see the capture rectangle or reach the start button after
stepping far enough away to fit his full body in the iPhone frame.

Shipped in commit `0bf3518`:
- Replaced the low-opacity 1px guide with a solid 3px bright-green rectangle,
  heavy 6px corners, black contrast outline, and green glow.
- Full-body readiness now requires tracked shoulders, wrists, hips, knees, and
  ankles to remain inside the guide for three continuous seconds.
- The trial starts automatically after that three-second framing hold. `Start
  now` remains available only as a nearby fallback.
- Added a distance-readable camera prompt that always names `Overhead squat`,
  `Front view`, and `3 reps`, then changes through framing, neutral baseline,
  repetition, finish-hold, processing, success, and redo states.
- After rep three, recording continues until Pedro remains still with arms
  overhead for three seconds. Movement or lost framing resets the hold. The
  recording then stops, validates, and shows an explicit success or redo state.
- Phase 1 remains one movement only. Success is labelled `Movement 1 of 1` and
  advances to the existing result; later screening movements remain locked.
- Added pure tested capture-guide, continuous-hold, and pose-stillness helpers.

Verification:
- `npm run test:movement-screening`: 20/20 pass.
- `npx tsc --noEmit`: pass.
- Targeted movement-screening ESLint: pass.
- `npm run build`: pass.
- In-app browser preview was unavailable, so the real iPhone remains the visual
  and camera-behaviour acceptance surface.

NEXT:
1. Fully reload the route on the iPhone and tap `Enable camera` while near the
   phone.
2. Step back with arms overhead and confirm the brighter guide remains visible.
3. Confirm the three-second in-frame countdown starts and resets if Pedro steps
   outside the guide.
4. Let the trial auto-start, hold the baseline, complete three 2-1-2 squats,
   then stand still for the final three-second auto-save.
5. Confirm `Recording successful`, camera shutdown, and the matched evidence
   pair before continuing the remaining technical acceptance.



### Cerebro Studio Phase 2 (2026-07-05, LATEST)

Recorder controls for the desktop path. Builds on the mobile camera-only mode
(ece3169) and desktop dual export (8c8ffea).

Shipped (app/dashboard/studio/: StudioApp.tsx, useRecorder.ts, new useHotkeys.ts):
- Reachable Layouts 1 (screen + cam bubble), 2 (camera only), 3 (screen only) via
  a segmented switcher with an active indicator and a keyboard legend.
- Hotkeys: 1/2/3 jump to a layout, Space cycles 1->2->3->1, Esc cancels the
  countdown or stops recording. Ignored while a form control is focused; Space
  blurs the focused control and preventDefaults.
- 3-2-1 countdown overlay before recording, rendered in React (never drawn on the
  canvas) so it is NOT baked into the take; tap the overlay or press Esc to cancel.
- Pause / resume via MediaRecorder pause()/resume() on both recorders. Elapsed
  timer freezes on pause via accumulated-segment accounting; amber PAUSED badge.
  Layout switching + hotkeys work before AND during recording.
- `layout` is now stateful (forced to 2 in camera-only mode); `config` memoized.
  The "share your screen" hint only shows for layouts that need the screen (1, 3).

Verification (Playwright, throwaway /studio-preview with screen+camera faked,
then deleted):
- tsc + Studio ESLint: clean.
- Pixel-sampled the canvas per layout: L1 screen+bubble, L2 all camera, L3 all
  screen. Hotkeys 1/2/3 + Space-cycle (with wrap) + Esc-stop all drive it.
- Countdown showed 3/2/1 and recording started at ~3.1s (after the full delay).
- Pause froze the timer at 00:33 and PAUSED showed; Resume advanced to 00:34; a
  paused-then-stopped take still finalized BOTH 1920x1080 + 1080x1920 cuts.
- 0 console errors.

NEXT:
1. Pedro laptop check at /dashboard/studio: try the layout buttons + hotkeys
   (1/2/3, Space, Esc), the 3-2-1 countdown, and pause/resume with a REAL camera.
   Also the still-open dual-export real-camera framing check and desktop bubble
   sign-off (both close out Phase 1 + confirm the recent features on real hardware).
2. Phase 3 remaining (not started): orientation picker, camera-bubble position /
   size pickers, Document Picture-in-Picture floating control panel, review polish.
3. Mobile screen+facecam still deferred (native ReplayKit only).

### Movement Screening framing and tempo overlay (2026-07-05)

Pedro requested a clearer indication of where to stand, slower movement
instructions, and all camera-overlay text contained inside the portrait
viewfinder guide.

Shipped:
- Replaced the faint corner-only guide with a complete bright-green full-body
  capture rectangle and a subtle dashed centre line.
- Moved camera status, baseline countdown, repetition counter, positioning
  guidance, and tempo text inside the rectangle.
- Positioning guidance changes from `Step back` to `Stay centred` when the
  required wrists, hips, knees, and ankles are tracked.
- Added a persistent controlled tempo cue: 2 seconds down, 1 second pause,
  2 seconds up.
- Updated the Capture Protocol copy to repeat the same three-repetition tempo.
- Added a synthetic 2-1-2 movement test proving three repetitions remain below
  the existing six-second per-repetition ceiling.
- Pose coordinates, mirroring, metrics, quality gates, and rules are unchanged.

Verification:
- `npm run test:movement-screening`: 18/18 pass.
- `npx tsc --noEmit`: pass.
- Targeted movement-screening ESLint: pass.
- `npm run build`: pass.
- Production deployment `dpl_B2DekrHWxF57T8qVnDx4KBVpWxgw` is Ready and
  aliased to `https://cerebroai.au`.
- The automated browser preview was unavailable, so Pedro's iPhone remains the
  visual containment and alignment gate.

NEXT:
1. Fully reload Movement Screening on the iPhone.
2. Confirm the green rectangle is clear and every overlay label stays inside it.
3. Confirm the green landmarks align while standing inside the rectangle.
4. Run one 2-1-2 three-repetition trial and verify automatic completion.
5. Continue the three-trial technical acceptance only after that check passes.

### Cerebro Studio desktop dual export (2026-07-04)

Pedro wanted, from a laptop recording, to get BOTH a landscape and a portrait
(9:16) version so he can download both. (Mobile screen+facecam is off the table
for now: iOS blocks web screen capture, so a phone recording your screen across
apps with a facecam bubble needs a native ReplayKit app, not the web. Kept mobile
as the camera-only recorder.)

Shipped (four files in app/dashboard/studio/):
- Record once, get two cuts. While recording, the compositor paints a second
  portrait canvas every frame and a second MediaRecorder encodes it, so Stop
  produces both files with no processing wait.
- Portrait framing Pedro chose: screen full-width as a readable rounded card on
  top, camera filling the larger band below (`drawPortraitStacked` in layouts.ts).
- `mergeAudioTracks(streams, outputs)` now fans the mixed mic/system audio into N
  independent tracks so each recorder gets its own audio.
- `useCompositor` takes an optional portrait canvas + active flag.
- StudioApp: second `useRecorder`, a 'Portrait cut' On/Off toggle (default on,
  desktop only), a live portrait preview thumbnail under the stage, dual download
  buttons (landscape / portrait) in review, and a completion coordinator that
  finalizes only after BOTH takes flush so neither is truncated.
- Camera-only mobile path unchanged (single portrait video, no toggle).

Verification (Playwright, throwaway public /studio-preview with screen+camera
faked, then deleted):
- tsc + Studio ESLint: pass.
- Setup shows Portrait cut On + a live 9:16 preview of the stacked layout.
- Record -> stop produced a real 1920x1080 landscape AND 1080x1920 portrait, both
  playable; review shows both videos + both download buttons; 0 console errors.

NEXT:
1. Pedro test on the laptop at /dashboard/studio: share screen, record, confirm
   BOTH downloads and that the portrait cut frames the screen+face well with a
   real camera (fake cam only proved the mechanics).
2. Perf note: two simultaneous VP9 MediaRecorders (8 + 6 Mbps) on a laptop; fine
   in testing, but watch on lower-end machines. Toggle Portrait cut off to skip it.
3. Mobile screen+facecam intentionally deferred (native-only). Desktop bubble
   sign-off still open.

### Movement Screening portrait phone capture (2026-07-04)

Pedro confirmed the iPhone 16 Pro camera, worker, and green pose overlay now
start successfully after the classic-loader fix. The remaining usability issue
was that the capture stage still used the desktop landscape treatment on the
portrait phone.

Shipped:
- Phone portrait orientation now requests a 720 x 1280 front-camera stream with
  a 9:16 ideal aspect ratio; landscape screens retain 1280 x 720 and 16:9.
- Mobile capture uses a centered 9:16 viewfinder with matching `object-cover`
  transforms on the video and landmark canvas, preserving overlay alignment.
- Desktop retains its current wide `object-contain` stage.
- Expanded the portrait green framing guide and moved the live rep counter away
  from the top status badge.
- Reduced phone container/title spacing, prevented horizontal overflow, made
  primary controls full-width touch targets, and allowed result actions to
  wrap.
- Added a deterministic orientation-constraint test. Pose metrics, rules,
  mirroring, and anatomical coordinates are unchanged.

Verification:
- `npm run test:movement-screening`: 17/17 pass.
- `npx tsc --noEmit`: pass.
- Targeted movement-screening ESLint: pass.
- `npm run build`: pass.
- Production deployment `dpl_CeG6qq43WT5c7u4rLbpxNmzJ2Cst` is Ready and
  aliased to `https://cerebroai.au`.
- Local responsive browser screenshot validation was unavailable; Pedro's
  iPhone is the visual acceptance surface.

NEXT:
1. Fully reload the iPhone Movement Screening route and confirm the camera
   viewfinder is portrait, contained, and the green overlay follows the body.
2. Record the iOS version, Chrome version, camera label, source resolution,
   worker delegate, and inference FPS.
3. Complete three ordinary technical trials and transfer each video/JSON pair.
4. Verify exact three-rep detection, playback, timestamp alignment, sharing,
   camera cleanup, and no capture upload.
5. Only after those three trials pass, begin Pedro-labelled calibration.

### Movement Screening iPhone worker-loader fix (2026-07-04)

Pedro's first iPhone 16 Pro test reached the camera workflow but MediaPipe failed
before either delegate initialized:

`GPU: import.meta is only valid inside modules | CPU: import.meta is only valid inside modules`

Root cause:
- The prior desktop fix correctly left Turbopack's generated worker bootstrap as
  a classic worker because that bootstrap loads chunks with `importScripts()`.
- The pose worker still explicitly selected MediaPipe's ES-module WASM loader.
- On iOS Chrome, the classic worker parsed that loader through `importScripts()`
  and rejected its `import.meta` syntax. GPU and CPU both use the same loader,
  so both failed before inference began.

Shipped:
- Explicitly selected MediaPipe's official classic WASM loader inside the
  classic Turbopack worker.
- Added a regression test locking that worker/loader pairing.
- Updated the root `pose-extraction` skill with the verified iOS guardrail.
- Metrics, rules, thresholds, model, capture, and evidence handling are
  unchanged.

Verification:
- `npm run test:movement-screening`: 16/16 pass.
- `npx tsc --noEmit`: pass.
- Targeted movement-screening ESLint: pass.
- `npm run build`: pass.
- Emitted worker uses a classic Turbopack bootstrap, exports
  `MEDIAPIPE_WASM_USE_MODULE=false`, and contains neither the module-loader
  filename nor `import.meta`.
- Classic JS/WASM asset hashes match the checked-in manifest.
- Production deployment `dpl_6iohx8rtY5yQxfzG1vEdrz5qdRN3` is Ready and
  aliased to `https://cerebroai.au`.
- Protected route returns 307 to login with `Permissions-Policy: camera=(self)`.
- Production classic loader and WASM return 200 over HTTPS with immutable
  caching; WASM uses `application/wasm`.

NEXT:
1. On iPhone Chrome, fully reload
   `https://cerebroai.au/dashboard/pt/movement-screening`.
2. Tap `Enable camera`.
3. Confirm the model reaches `Ready to record` and the green overlay appears.
4. If another red error appears, send its exact text or a screenshot.
5. Do not calibrate thresholds until all three phone technical trials pass.

### Cerebro Studio mobile / camera-only mode (2026-07-04)

Pedro hit "Could not start your screen. Retry." on his iPhone when trying to
record. Root cause is a platform limit, not a layout bug: `getDisplayMedia`
(screen capture) does not exist in any iOS browser (or some mobile browsers),
so the Share-screen step can never succeed on a phone. The front camera worked
(that's `getUserMedia`), so mobile Studio is now a camera recorder.

Shipped (only `app/dashboard/studio/StudioApp.tsx` touched):
- Feature-detect screen capture via `useSyncExternalStore` (server snapshot =
  supported → desktop layout; client re-renders to the real value with no
  hydration mismatch, no setState-in-effect).
- When absent → camera-only mode: force Layout 2 (camera fills) + portrait
  orientation, canvas dims from `ORIENTATION_DIMS` (1080×1920), 6 Mbps bitrate.
- Record enabled with just the camera (`canRecord = !!camMicStream`); Share-
  screen + System-audio controls and the "share your screen" overlay hidden.
- Front/back **Flip camera** button (shown when ≥2 cameras), plus a note that
  screen + camera needs a laptop. Mode-aware recording/header copy.
- Portrait 9:16 stage (`aspect-[9/16] h-[68vh]`) and matching review player;
  mobile padding polish (`p-4 sm:p-6 md:p-8`). Desktop landscape path unchanged.

Verification (Playwright, throwaway public `/studio-preview` route with media
stubbed, then deleted):
- `npx tsc --noEmit`: pass. Studio ESLint: pass.
- Camera-only branch renders portrait stage + Flip/mic/note; Share-screen hidden.
- Record → stop → review produced a real **1080×1920 portrait** WebM (~12 MB);
  Download / Record again / Discard present; Record again returns to setup live.
- Flip camera fires without error; no console errors, no hydration warnings.
- Desktop landscape path (Share screen + camera bubble) confirmed still rendering.

NEXT:
1. Pedro retest on iPhone at `/dashboard/studio` (log in first). Expect: no
   screen error, portrait camera preview, record + download a portrait clip.
2. If good, Phase 1 sign-off still pending on the desktop bubble retest too.
3. Not yet done: real front/back swap couldn't be exercised (test stub can't
   switch devices), so a quick real-device check that Flip changes cameras is worth doing.

### Movement Screening iPhone capture (2026-07-04)

Pedro's laptop webcam is not working. Pedro explicitly changed the Phase 1 capture/calibration device to the iPhone 16 Pro front camera. The laptop remains the place to inspect transferred evidence and calibrate rule JSON.

Shipped:
- Kept the same `live_camera -> pose -> metrics -> rules` pipeline; no phone-specific metric or rule branch was added.
- Added runtime MediaRecorder selection for WebM and iPhone-compatible MP4, with the correct file extension carried into the matched JSON filename.
- Added a first-painted-frame gate so pose initialization does not begin over a black camera preview.
- Camera provenance now includes the browser-visible front-camera label.
- Added `Share evidence` for transferring the matching video and JSON together through the iOS share sheet. Separate Video and JSON downloads remain as fallback.
- Replaced laptop-specific interface copy with device-neutral front-camera copy.
- Added `docs/movement-screening/PHONE-CAPTURE-TEST-GUIDE.md`.
- Updated the persisted Phase 1 checklist. This device change does not unlock the later client phone flow or any later PRD phase.

Verification:
- `npm run test:movement-screening`: 15/15 pass, including MP4/WebM evidence-pair naming.
- `npx tsc --noEmit`: pass.
- Targeted movement-screening ESLint: pass.
- `npm run build`: pass with the PT movement-screening route registered.
- Compiled worker still uses the corrected Turbopack worker constructor without the incompatible module flag.
- Git push triggered production deployment `dpl_gKCxQZugPt3tgkQpxmEQoB4T8Cfq`, which is Ready and aliased to `https://cerebroai.au`.
- Production protected route returns 307 to `/login` with `Permissions-Policy: camera=(self)`.
- Production model and module WASM return 200 over HTTPS with immutable one-year caching; WASM uses `application/wasm`.

NEXT:
1. On iPhone Chrome, open `https://cerebroai.au/dashboard/pt/movement-screening` and log in if required.
2. Follow `docs/movement-screening/PHONE-CAPTURE-TEST-GUIDE.md`.
3. Report the exact status/error if the camera does not reach `Ready to record`.
4. Do not calibrate thresholds until three phone technical trials pass.

### Movement Screening Chrome startup fix (2026-07-04)

Pedro's built-in camera light turned on, the preview stayed black, and the light then turned off. `getUserMedia()` was succeeding; the failure occurred when pose initialization began.

Root cause:
- Next.js 16.2.10 Turbopack compiles the worker entry through a classic bootstrap that loads bundled chunks with `importScripts()`.
- `PoseWorkerClient` forced `{ type: "module" }`.
- Chrome does not permit `importScripts()` inside a module worker, so the worker failed before MediaPipe could initialise and the camera cleanup path stopped the stream.

Shipped:
- Removed the incompatible module-worker option from the Turbopack-generated worker constructor.
- Kept MediaPipe's versioned module WASM loader enabled inside the dedicated worker.
- Added readable GPU and CPU initialization errors plus a message-deserialization failure path.
- Updated the root `pose-extraction` skill and Phase 1 checklist with the bundler guardrail.

Verification:
- `quick_validate.py` passes for `pose-extraction`.
- `npm run test:movement-screening`: 14/14 pass.
- `npx tsc --noEmit`: pass.
- Targeted movement-screening ESLint: pass.
- `npm run build`: pass.
- Compiled client code now constructs the Turbopack worker without `{ type: "module" }`.

NEXT:
1. Pedro hard-refreshes `/dashboard/pt/movement-screening` on the fresh Next.js 16.2.10 server.
2. Confirm the camera image remains visible, model status reaches `Ready to record`, and green landmarks render.
3. Continue the laptop test guide only after this startup gate passes.

### Movement Screening Phase 1 technical build (2026-07-04, LATEST)

Source of truth: `docs/movement-screening/PHASE-1-CHECKLIST.md`. Pedro test steps: `docs/movement-screening/LAPTOP-TEST-GUIDE.md`.

Implemented:
- New authenticated PT route `/dashboard/pt/movement-screening`, directly after M & L Assessment.
- User-gesture laptop front camera, mirrored preview plus bright-green landmark overlay, exact three-rep flow, live baseline/rep counter, automatic completion, local WebM recording, result JSON, and matched calibration-bundle download.
- Exact-pinned `@mediapipe/tasks-vision@0.10.35`; Google Full float16 v1 model and required WASM variants are checksum-verified and self-hosted under `/public/vendor/mediapipe/0.10.35`.
- MediaPipe runs only in a dedicated classic worker with its classic WASM loader: one transferred bitmap in flight, no queue, GPU first, CPU-worker fallback, no accepted main-thread path.
- Shared device-independent contracts for `live_camera`, `uploaded_video`, and `self_screening`; only live camera is implemented in Phase 1.
- Deterministic pixel-space metrics: neutral-offset hip translation / neutral hip width and front-view hip-knee vertical margin / neutral femur length.
- Pure validated JSON rules engine with no executable rules, explicit provenance, comparison bounds, anatomical direction, and uncalibrated labelling.
- New RLS-protected `pt_movement_screening_rule_versions` Supabase table. App users have Pedro/admin read-only access; anon and browser writes are blocked; one immutable active version is enforced. Active v1 is intentionally `uncalibrated`.
- Six root skills created/validated. Only `pose-extraction`, `metrics-extraction`, and `rules-engine` are functional; commentary/report/refinement remain hard-stop stubs.
- Next patched from 16.2.4 to 16.2.10, with exact patched PostCSS and ws resolutions. Production dependency audit excluding the unused optional PDF canvas path is zero.

Verification:
- `npm run test:movement-screening`: 13/13 pass.
- `npx tsc --noEmit`: pass.
- Targeted movement-screening ESLint: pass.
- `npm run build`: pass; route registered and worker emitted as a separate chunk.
- Unauthenticated route returns 307 to `/login`.
- Versioned model/WASM responses return 200 with immutable one-year caching.
- Model SHA-256 and all WASM hashes match the checked-in manifest.
- Supabase: RLS enabled, one policy, anon select false, authenticated select true, authenticated write false, five indexes. Security advisor added no movement-screening finding.
- Full-repo ESLint still has pre-existing errors outside this feature; no unrelated lint cleanup was mixed in.

Latest browser-acceptance evidence:
- Test environment identified as MacBook Pro `MacBookPro15,1`, macOS 15.7.7 build 24G720, Chrome 149.0.7827.198.
- Chrome is running. The Codex Chrome Extension 1.1.5 is installed and enabled in the selected Default profile, and its native-host manifest is valid.
- Browser control still cannot attach. Pedro approved opening a fresh Chrome window, but the plugin helper failed in macOS LaunchServices; the required connection retry also failed.
- Per the Chrome plugin recovery contract, reinstall the Chrome plugin from the Codex plugin UI before retrying. Do not use AppleScript or another browser-control workaround.

NEXT:
1. Reinstall the Chrome plugin from the Codex plugin UI, then restart Codex if prompted.
2. Retry browser control in Pedro's authenticated desktop Chrome session.
3. Open `/dashboard/pt/movement-screening` and follow `docs/movement-screening/LAPTOP-TEST-GUIDE.md`.
4. Confirm real camera permission, camera label, overlay alignment, anatomical direction, GPU/CPU-worker FPS, exact three-rep completion, WebM playback, JSON/video alignment, camera shutdown, and no capture upload.
5. If technical acceptance passes, record clean, left/right shift, adequate/borderline/insufficient-depth calibration pairs.
6. Do not begin phone work or later skills. Pedro's labelled videos/JSON define rules v2; activate it as data without deploying.

Known blocker:
- Automated browser control cannot attach to Pedro's Chrome session despite valid extension and native-host checks. Reinstall the Chrome plugin from the Codex plugin UI before another automated attempt. The real camera/permission/WebM flow remains intentionally unverified.

### Cerebro Studio camera-bubble bugfix (2026-07-04, Claude)

Studio has its own live tracker: `Cerebro Knowledge/cerebro-studio-todo.md` (read that to resume Studio work; this is just a pointer).

Phase 1 shipped in 0485aca. Pedro tested: screen + audio work; recording other Chrome tabs/windows while the Studio tab stays open works with no freeze; navigating the Cerebro app in the same tab stops recording (accepted limitation). Bug found: the camera face bubble never rendered. Cause: the hidden (display:none) camera source `<video>` stalled below readyState 2 in Chrome (a hidden camera feed is deprioritised, unlike the screen-capture feed which keeps decoding). Fix: the off-screen source videos are now rendered (1px, opacity 0, not display:none) with autoPlay, so the camera decodes and the bubble draws. tsc/eslint/build clean. Awaiting Pedro's retest of the bubble.

NEXT for Studio: Phase 2 (Layouts 2 & 3, hotkeys 1/2/3, spacebar cycle, countdown, pause/resume, Esc, legend) once Pedro signs off the bubble.

### Cerebro Studio Phase 1 (2026-07-04, LATEST)

New self-contained in-browser screen + camera recorder for the MAIN dashboard (not PT). PRD: `Cerebro Knowledge/cerebro-studio-prd.md`.

Route decision: PRD says `/studio`; built at **`/dashboard/studio`** so it inherits the dashboard admin gate + sidebar without restructuring routing (flagged to Pedro). Only two existing files touched beyond the feature folder: `app/dashboard/Sidebar.tsx` (added Studio nav item, glyph `⏺`) and `app/globals.css` (added a `.cerebro-studio`-scoped block so the recorder's square controls opt out of the global pill-button rules; it is scoped and cannot affect other pages).

Feature folder `app/dashboard/studio/`: `page.tsx`, `StudioApp.tsx` (orchestrator + setup/recording/review UI), hooks `useMediaStreams` / `useCompositor` / `useRecorder`, plus `layouts.ts`, `audio.ts`, `types.ts`. No PT code, no Supabase, no backend, no DB changes.

Phase 1 scope shipped: camera/mic device pickers (`enumerateDevices`), screen share via `getDisplayMedia`, system-audio toggle (default off, silent-fail), live canvas compositing of Layout 1 (screen letterboxed + rounded camera bubble, cover-cropped, bottom-right), merged mic audio via Web Audio, `MediaRecorder` vp9→vp8 fallback @ 8 Mbps, record/stop, review with playback + duration + size, download `cerebro-studio-YYYY-MM-DD-HHmm.webm`, WebM→MP4 note, inline permission errors with Retry, native "Stop sharing" finalizes gracefully. Landscape 1080p only in Phase 1. `layouts.ts` already draws layouts 2/3 (pure fns) but no UI/hotkeys reach them yet.

All capture tracks stopped on unmount / discard / record-again / screen-end (no orphaned camera light). Canvas is the single preview+record source, so it is deliberately NOT mirrored (recorded output must never mirror).

Verification: `npx tsc --noEmit` clean, `npx eslint` clean (fixed two React 19 set-state-in-effect findings properly), `npm run build` passes with `/dashboard/studio` registered. Browser recording flow (real camera/screen permissions) is UNVERIFIED by me; that is Pedro's test now.

NEXT (do not start until Pedro confirms Phase 1): Phase 2 = Layouts 2 & 3, hotkeys 1/2/3, spacebar cycle, countdown, pause/resume, Esc-to-stop, keyboard legend. Then Phase 3 = orientation picker (portrait), camera position + size pickers, Document PiP control panel, review polish.

### Programme day-count, save, and board reliability (2026-06-27, LATEST)

Pedro asked the programme agent for three full-body days for Annalise Knight. The chat captured three days, but the writer timed out and the deterministic fallback returned five. Manual corrections then failed to save with `TypeError: Failed to fetch`, and five equal-width board columns compressed exercise cards beyond their day columns.

Shipped:
- `rebuild-programme-phase` now treats the structured chat `days_requested` value as authoritative.
- Day-count parsing checks the latest coach messages first and supports numeric words plus phrases such as `3 times per week`, `3-day`, and `three full-body days`.
- Writer output has an exact-day contract, and a post-generation guard replaces mismatched output with the deterministic exact-count fallback.
- Added an authenticated same-origin programme PATCH route. It saves the programme first, retries transient browser failures once, and reports optional nutrition/note/event failures as warnings instead of losing the main save.
- Board view uses fixed 17rem day columns inside horizontal overflow, with wrapping and width containment on exercise cards.
- Corrected Annalise Knight's live Phase 2 to three full-body days with 27 linked exercise cards, three warm-ups per day, and no superset containing two main lifts.

Deployment:
- Deployed `rebuild-programme-phase` to Supabase.
- Deployed the production app to `https://cerebroai.au`.

Verification:
- Annalise's assignment has exactly 3 days: Full Body A, B, and C.
- All 27 exercises have library IDs.
- Each day has exactly 3 warm-ups.
- Main-lift superset conflict query returns zero rows.
- `npx tsc --noEmit --pretty false` passes.
- `npm run build` passes.
- New production PATCH route is live and rejects unauthenticated writes with HTTP 401.
- `git diff --check` passes.

Notes:
- The browser used by automated Playwright does not share Pedro's authenticated Chrome session, so authenticated visual interaction was not available. Production data, route availability, type checking, and the production build were verified directly.

### Adapt-current duplicate exercise non-fatal resolver (2026-06-25, LATEST)

Pedro retried `Adapt current phase` after v11 and the UI showed the real server error:
- `Could not create missing exercise cards: duplicate key value violates unique constraint "pt_exercises_name_idx"`

Root cause:
- v11 still used one bulk insert for missing exercise cards.
- If any missing exercise was a lower-case duplicate, Postgres rejected the whole insert.
- Because the whole bulk insert rolled back, genuinely new missing cards were still absent after the fallback re-read, so the function still failed.

Shipped:
- Removed the all-or-nothing bulk insert path.
- Added per-exercise missing-card resolution:
  - case-insensitive lookup first,
  - single-card insert second,
  - duplicate retry lookup third,
  - if it still cannot link/create the card, the generated phase continues with that exercise unlinked instead of failing.
- This means the builder can still return an editable programme even if one generated exercise card cannot be inserted.

Deployment:
- Deployed `rebuild-programme-phase` ACTIVE v12 on Supabase project `otcnrkfvgyvwolironoz`.

Verification:
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- `git diff --check` passes.
- `supabase functions list` confirms `rebuild-programme-phase` ACTIVE v12.

Notes:
- No schema migration was needed.
- The previously failed v11 run remains failed; retry from the programme editor to create a fresh v12 run.

### Adapt-current duplicate exercise and equipment parser fix (2026-06-25)

Pedro retried `Adapt current phase` for Olga and the UI still showed `Edge Function returned a non-2xx status code`.

Observed in Supabase:
- `rebuild-programme-phase` v8 failed with:
  - `Could not create missing exercise cards: duplicate key value violates unique constraint "pt_exercises_name_idx"`
- The same failed run showed strict equipment inference had incorrectly allowed `cable` and `band` because the assistant summary mentioned replacements/avoid items containing those words.

Shipped:
- `assemblePhase()` now de-dupes missing exercise card creation by lower-case name before insert.
- If the insert still hits a duplicate race/existing library issue, the function re-reads `pt_exercises`, links the existing card, and continues instead of failing the phase.
- Strict equipment inference now uses coach/user messages first and no longer treats assistant-generated summaries as available-equipment evidence.
- `no cable` / `no band` instructions are now respected; those words no longer add cable/band to the allowed list.
- Programme editor now reads JSON error bodies from Supabase `FunctionsHttpError.context`, so future failures show the function's real `{ error }` message instead of only `Edge Function returned a non-2xx status code`.

Deployment:
- Deployed `rebuild-programme-phase` ACTIVE v11 on Supabase project `otcnrkfvgyvwolironoz`.

Verification:
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- `git diff --check` passes.
- `supabase functions list` confirms `rebuild-programme-phase` ACTIVE v11.
- Direct service-role curl smoke test reached v10/v11 endpoint but returned the function's expected `Unauthorized` path because this function requires an authenticated Pedro session. Live browser retry is the correct end-to-end test.

Notes:
- No schema migration was needed.
- The previously failed run remains failed; retry from the programme editor to create a fresh v11 run.

### Adapt-current non-2xx fix (2026-06-25, LATEST)

Pedro clicked `Adapt current phase` for Olga and the UI showed `Edge Function returned a non-2xx status code`.

Observed in Supabase:
- `rebuild-programme-phase` v7 returned HTTP 500.
- The run `0139557e-0bb4-4b9e-aa87-f8951b480eb2` reached:
  - `PHASE_CONTEXT_READER`
  - `PHASE_ADAPT_CURRENT`
  - `PHASE_STRUCTURE_PLANNER`
- It crashed after that during final assembly/audit/response and was left stuck as `running`.

Shipped:
- Final assembly now stores `section` on every mapped exercise, not only `section_start`, so old programme JSON with section carry-forward is classified correctly.
- Muscle/tag metadata parsing is defensive; malformed/non-array exercise metadata cannot crash the audit.
- The post-adapter assembly/audit/update block now has its own catch:
  - marks the run as `failed`,
  - saves the exact error to `failure_reason`,
  - returns `{ error: reason }` instead of a generic non-2xx.
- Marked the stale v7 Olga run as failed with a retry note.

Deployment:
- Deployed `rebuild-programme-phase` ACTIVE v8 on Supabase project `otcnrkfvgyvwolironoz`.

Verification:
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- `git diff --check` passes.
- `supabase functions list` confirms `rebuild-programme-phase` ACTIVE v8.

Notes:
- No schema migration was needed.
- Retry `Adapt current phase`; if any hidden issue remains, v8 will show the exact assembly error instead of the generic Edge Function message.

### Phase agent adapt-current mode (2026-06-25, LATEST)

Pedro clarified that the phase agent should not always redo the whole phase. Olga's case is the example: if the existing programme is good and Pedro gives an equipment list, the agent should adapt the current phase to those constraints instead of creating a new programme.

Shipped:
- `rebuild-programme-phase` now detects generation mode from the chat:
  - `adapt_current` when Pedro says adapt, adjust, modify, current programme/current phase, equipment, access, or available equipment.
  - `rebuild_phase` when Pedro says redo, rebuild, from scratch, new programme/new phase, or whole programme.
- Adapt-current mode is deterministic:
  - clones the selected phase,
  - preserves day structure, phase blocks, sets, reps, rest, and allowed exercises where possible,
  - applies strict equipment filtering/replacement,
  - regenerates warm-ups after the existing Workout sections are checked.
- Rebuild mode keeps the existing AI writer + deterministic fallback behaviour.
- The programme editor UI now changes language based on inferred mode:
  - `Adapt current phase` for adaptation,
  - `Generate replacement phase` for rebuilds,
  - confirmation/status messages now say adapt vs replace correctly.
- The chat system prompt and project skills now tell the agent to detect scope before changing a phase.

Deployment:
- Deployed `rebuild-programme-phase` ACTIVE v7 on Supabase project `otcnrkfvgyvwolironoz`.

Verification:
- `quick_validate.py` passes for:
  - `pt-phase-programme-writer`
  - `pt-workout-structure-planner`
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- `git diff --check` passes.
- `supabase functions list` confirms `rebuild-programme-phase` ACTIVE v7.

Notes:
- No schema migration was needed.
- No live Olga generation was run because it would create real generation run records and potentially missing exercise cards.

### Phase rebuild warm-up and equipment guardrails (2026-06-25, LATEST)

Pedro reported the phase builder kept generating the same three warm-ups on every day and added Hamstring Curl even when Olga's available-equipment list did not include that machine.

Shipped:
- Created new root skill outside app git:
  - `skills/pt-warmup-selector/SKILL.md`
- Updated root programming skills and `AGENTS.md` so selected-phase rebuild now chains:
  - workout structure,
  - programme writer,
  - warm-up selector,
  - volume/pattern audit.
- `rebuild-programme-phase` now prompts the AI to:
  - build the Workout section first,
  - then select exactly 3 warm-ups from Pedro's preferred pool,
  - keep Dead Bug, Bird Dog, Cobra to Child Pose, Downward Dog, Spiderman Lunge with Thoracic Rotation, Glute Bridge, Hip Airplanes, and Clamshells out of the Workout section unless Pedro explicitly overrides,
  - respect limited equipment lists strictly.
- Added deterministic server-side enforcement:
  - generic/generated warm-up blocks are removed during assembly,
  - each day gets a fresh 3-exercise warm-up selected from the final Workout patterns,
  - warm-up-only drills found in Workout are replaced or dropped,
  - unavailable exercises are replaced or dropped before the draft returns,
  - Hamstring Curl / Leg Curl is blocked unless a hamstring curl or leg curl machine is explicitly available.
- The exercise library query now reads `equipment` so the guard can use existing library metadata.

Deployment:
- Deployed `rebuild-programme-phase` ACTIVE v6 on Supabase project `otcnrkfvgyvwolironoz`.

Verification:
- `quick_validate.py` passes for:
  - `pt-warmup-selector`
  - `pt-programme-builder`
  - `pt-phase-programme-writer`
  - `pt-workout-structure-planner`
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- `git diff --check` passes.
- `supabase functions list` confirms `rebuild-programme-phase` ACTIVE v6.

Notes:
- No schema migration was needed.
- No live client generation was run during verification because it can create real generation runs and missing exercise cards.

### Programme edit page streamlined around one phase selection (2026-06-25, LATEST)

Pedro reported the programme edit page had become messy: phases were selected in multiple places, nutrition listed every phase at once, and workouts required selecting the phase again.

Shipped:
- Replaced the large all-phase card stack with a compact horizontal programme stepper.
- The selected phase now drives the whole page:
  - phase setup,
  - nutrition card,
  - programme agent,
  - workout list/board.
- Phase setup is now a single active-phase card with the existing editable fields:
  - name,
  - weeks,
  - focus,
  - progression notes,
  - progressive overload / week blocks,
  - voice input for week blocks.
- Phase nutrition is now a card for the selected phase only.
  - It stays collapsed by default.
  - Clicking opens training context, editable recommendations, approve action, and apply daily targets when all phases are approved.
- Removed the duplicate phase selector from the Workouts section. The top programme stepper is the only phase selector.
- Removed unused phase drag/edit state from the component.

Verification:
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- `git diff --check` passes.

Notes:
- No schema or Supabase deploy was needed. This is a UI-only workflow cleanup in the programme edit page.

### Chat-style PT phase rebuild agent (2026-06-25, LATEST)

Pedro wanted the selected-phase programme builder to feel like chatting with an agent, not a form. The agent needed to read client needs, movement analysis, injuries, weak/tight muscles, recent training, 1RM results, and then build balanced weekly programming around movement patterns and weekly set volume.

Shipped:
- `rebuild-programme-phase` is now a persisted chat workflow with actions:
  - `start`
  - `message`
  - `generate`
  - backward-compatible `check`
- Chat state persists to existing generation tables:
  - run: `pt_program_generation_runs.task_type = phase_rebuild_chat`
  - turns/chain steps: `pt_program_generation_steps`
- Programme editor builder now shows:
  - chat transcript,
  - one text/voice input,
  - `Send to agent`,
  - captured plan summary,
  - `Generate replacement phase`.
- The agent asks one critical question at a time, then returns ready state.
- Generation reads broader client context:
  - client profile,
  - exercise doc and movement assessment fields,
  - notes,
  - messages,
  - client documents,
  - brain/lifestyle/nutrition docs,
  - recent workouts and set logs,
  - highest stored Big 5 1RM map,
  - exercise library.
- Generation/audit now records:
  - split selected,
  - weekly set volume,
  - movement-pattern coverage,
  - unilateral/bilateral balance,
  - client needs applied,
  - assumptions,
  - review notes,
  - web research usage.
- Split rules implemented in the prompt and audit:
  - 2 days = Full Body A/B,
  - 3 days = Full Body A/B/C,
  - 4 days = Lower A / Upper A / Lower B / Upper B,
  - 5 days = Lower A / Upper A / Full Body / Lower B / Upper B.
- Pattern tags are now written onto generated exercises where possible:
  - horizontal/vertical push-pull,
  - squat/hinge,
  - unilateral/bilateral lower,
  - single-arm/two-arm push-pull,
  - core/corrective.
- Created/updated project skills outside the app git repo:
  - `pt-phase-rebuild-chat-orchestrator`
  - `pt-client-needs-reader`
  - `pt-workout-structure-planner`
  - `pt-weekly-volume-pattern-auditor`
  - `pt-phase-programme-writer`
  - Root `AGENTS.md` now documents the new chain.
  - `pt-programming-workflow` now has an explicit selected-phase chat exception to the old "Big 5 every day" rule.

Deployment:
- Deployed `rebuild-programme-phase` ACTIVE v2 on Supabase project `otcnrkfvgyvwolironoz`.

Verification:
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- `git diff --check` passes.
- All five new skills pass `quick_validate.py`.
- `supabase functions list` confirms `rebuild-programme-phase` ACTIVE v2.

Notes:
- No schema migration was needed. The feature reuses existing `pt_program_generation_runs` and `pt_program_generation_steps`.
- No live generation was run against a real client during verification because that would create a real generation run and may create missing exercise cards.

### Programme builder voice + text unified (2026-06-25, LATEST)

Pedro reported that he typed a phase brief, then tried to continue with voice, but the UI showed a microphone `not-allowed` error. He also clarified that `Build with voice` and `Build from text` should be the same feature.

Root cause:
- Programme edit still had two different generation paths:
  - `+ Build with voice` used the newer selected-phase rebuild agent.
  - `+ Build from text` used the older append-new-phase text builder.
- The microphone permission error preserved the textarea, but the copy made it feel like the app could not continue.

Shipped:
- Programme edit now shows one `+ Build with voice/text` button.
- The builder panel accepts typed text, dictated voice, or both in the same brief.
- Starting voice after typing now appends dictated text to the existing brief instead of treating voice as a separate flow.
- The separate `+ Build from text` panel and old append-phase action were removed from this page.
- The combined builder still replaces only the selected phase locally; Pedro reviews and presses `Save changes` to persist.
- Microphone blocked/no-speech states now keep the typed brief and show clearer guidance. Browser permission still has to be allowed in Chrome site settings if Chrome returns `not-allowed`.

Verification:
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- `git diff --check` passes.

Notes:
- No schema or Supabase function deploy was needed. This is a UI/client flow change around the existing `rebuild-programme-phase` Edge Function.

### PT Sessions exercise swaps persist to active programme (2026-06-25, LATEST)

Pedro reported that he swapped exercises while tracking Stephen's Day 1 workout in PT Sessions, but the swapped exercises were not saved into the client's programme.

Root cause:
- `swapExercise()` only wrote to local `exerciseOverrides` state.
- `Finish session` logged sets using the swapped exercise, but the assignment update only advanced the programme cursor.
- The active `pt_program_assignments.programme` JSON was never patched, so the next view still showed the original exercise.

Shipped:
- `PTSessionsView` now applies session exercise overrides to the selected active programme day when Pedro presses `Finish session`.
- The programme patch happens after workout/set logs are inserted and before session credit deduction.
- If the programme patch fails, the flow stops before deducting the session and shows: `Workout saved, but programme update failed: ...`.
- The patch preserves the original exercise slot structure:
  - same exercise `id`,
  - same sets/reps/rest,
  - same section/superset/week overrides,
  - only exercise identity fields change: `exercise_id`, `name`, `notes`, `video_url`, `cues`, `pattern`.
- The swap UI now preserves the original exercise prescription instead of defaulting a swapped exercise to `3 x 8-12`.
- Inserts a `pt_events` row with `event_type = programme_exercise_swapped` and swap metadata.
- Reloads client data after finish so Pedro sees the updated programme immediately.
- Created project skill outside the app repo:
  - `skills/pt-session-programme-swap-sync/SKILL.md`
  - Root `AGENTS.md` now documents the PT Session swap-sync rule.

Verification:
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- `git diff --check` passes.
- Skill validation passes for `pt-session-programme-swap-sync`.

Notes:
- No schema or Supabase function deploy was needed. This updates the existing `pt_program_assignments.programme` JSON from the authenticated dashboard client.
- No live Stephen session was finished during verification because that would write a real workout log and deduct a real session.

### Programme board-view supersets larger than 2 exercises (2026-06-24, LATEST)

Pedro asked to drag exercises into other supersets in board view so a superset can contain 3+ exercises, instead of the board being limited to visual pairs of 2.

Shipped:
- Updated shared programme board grouping in `utils/pt/programme.ts`.
- Board view now respects real `superset_id` groups, so one superset can render 2, 3, 4, or more exercises.
- Older programmes without stored `superset_id` still fall back to the previous visual Workout pairing by position.
- Added `moveExerciseIntoProgrammeSuperset()` helper:
  - dropping an exercise onto a visible superset band joins that superset,
  - dropping onto a visual pair creates a real stored superset from that pair plus the dropped exercise,
  - dragging an exercise onto a normal day/card drop removes old superset membership so it becomes standalone,
  - singleton leftovers have their `superset_id` cleared so old hidden group IDs do not confuse future board rendering.
- Wired the behavior into all programme board editors:
  - active assignment editor: `app/dashboard/pt/programmes/[id]/edit/PTProgrammeEditView.tsx`
  - new programme wizard: `app/dashboard/pt/programmes/new/PTProgrammeWizard.tsx`
  - template editor: `app/dashboard/pt/programmes/template/[id]/edit/PTProgrammeTemplateEditView.tsx`

Verification:
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- `git diff --check` passes.

Notes:
- No schema or Supabase deploy was needed. Superset membership already lives in programme JSON as `exercise.superset_id`.

### Henrique client AI live-context upgrade (2026-06-24, LATEST)

Pedro reported that the client-side AI could not answer a question about a previous exercise. Root cause:
- `ai-client-chat` only passed a shallow workout summary (`10 recent sessions logged`) to the model.
- It did not include exact workout/set history.
- It did not search the client-specific `pt_client_brain_chunks` semantic memory.
- It had no web-search tool for general/current questions.

Shipped:
- `ai-client-chat` now retrieves live client context before every answer:
  - active programme details, current phase/week/block, current phase days/exercises, exercise notes and 1RM target notes,
  - last 100 workout logs,
  - exact set logs for those workouts, capped at 2,000 sets,
  - exercise-level history summary with latest logged session, latest sets/reps/load, best logged load, and session count,
  - recent nutrition logs and macro averages,
  - recent body metrics,
  - weekly check-ins,
  - Pedro notes,
  - recent message history,
  - durable client brain docs,
  - semantic matches from `match_client_brain_chunks`.
- The prompt now enforces an evidence hierarchy:
  1. live client context first,
  2. long-term client memory,
  3. Pedro knowledge base,
  4. bounded web research only for general/current knowledge gaps.
- Switched runtime answer generation to Claude Sonnet with Anthropic `web_search` capped at 2 uses.
- Kept OpenAI for embeddings and as fallback if Anthropic is unavailable.
- Created project skill outside the app repo:
  - `skills/pt-client-ai-live-coach/SKILL.md`
  - Root `AGENTS.md` now documents the client-side Henrique workflow.

Deployment:
- Redeployed `ai-client-chat` ACTIVE v17 on Supabase project `otcnrkfvgyvwolironoz`.

Verification:
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- `git diff --check` passes.
- Skill validation passes for `pt-client-ai-live-coach`.
- Supabase function list confirms `ai-client-chat` ACTIVE v17.

Notes:
- No live client chat message was sent during verification because it would write a real AI response into a real client's message history.

### Auto-apply 1RM percentages after testing (2026-06-24, LATEST)

Pedro clarified that after clients finish 1RM testing, the AI/system must automatically update programming and exercises with percentage-based kg suggestions using the max/highest 1RM kg result.

Shipped:
- `saveOneRmResults()` on the client profile now automatically invokes `recalculate-percentage-loads` after saving the 1RM test rows.
- The manual `Recalculate programme loads` button remains, but now uses the same helper as the automatic post-save flow.
- `recalculate-percentage-loads` now:
  - reads all stored 1RM rows for the client,
  - uses the highest `estimated_1rm_kg` per canonical Big 5 lift, falling back to `load_kg` if needed,
  - writes `current_1rm` to `pt_client_exercise_doc`,
  - stores `one_rm_map` and `resolved_loads` on assignment `validation_summary`,
  - updates the programme JSON itself with target notes on compatible exercises, e.g. `Target ~55kg @ 65% 1RM` or multi-block `Targets: Block 1 ~55kg @ 65% | ...`,
  - strips old target lines before writing new ones so reruns do not stack duplicate targets.
- The generation ledger records `RECALCULATE_PERCENTAGE_LOADS` with source `1rm_result` after automatic recalculation.
- Updated project 1RM skills outside the app repo:
  - `pt-record-1rm-results`
  - `pt-run-1rm-testing-session`
  - `pt-prescribe-workout-weights`
  They now document that highest stored 1RM drives the post-test prescription.

Deployment:
- Redeployed `recalculate-percentage-loads` ACTIVE v10 on Supabase project `otcnrkfvgyvwolironoz`.

Verification:
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- `git diff --check` passes.
- Skill validation passes for the updated 1RM skills.
- Supabase function list confirms `recalculate-percentage-loads` ACTIVE v10.

Notes:
- No live 1RM save was executed against a real client because it would write real 1RM rows and modify a real active programme.

### PT programme voice phase rebuild + 1RM kg suggestions (2026-06-24, LATEST)

Pedro asked for the programme editor to support a voice/chat agent that replaces the currently selected phase, instead of appending like `+ Build from text`.

Shipped:
- Programme edit page now has `+ Build with voice` beside `+ Build from text`.
- Pedro can dictate or type the phase brief, ask the agent what is missing, answer the questions, then generate a replacement draft.
- The generated draft replaces only the selected phase locally. It does not save or publish until Pedro clicks `Save changes`.
- New Edge Function `rebuild-programme-phase`:
  - validates Pedro/admin auth,
  - supports `check` and `generate` actions,
  - reads the selected assignment/phase, client profile, recent workout logs, recent set logs, client notes, client exercise doc, exercise library, and Big 5 1RM results,
  - asks short missing-detail questions before generation,
  - returns one replacement phase plus `one_rm_map`, `resolved_loads`, answered assumptions, and review notes,
  - creates missing `pt_exercises` cards with `video_url = null` so Pedro can add videos later.
- Board view now shows amber 1RM load chips on compatible Big 5 exercises when the phase has a percentage block and a 1RM exists.
- Existing `recalculate-percentage-loads` now uses the highest recorded Big 5 estimated 1RM per lift, matching Pedro's request, instead of stopping at the newest row.
- Coach PT Sessions and client workout logger set inputs now auto-propagate weights:
  - typing set 1 weight fills later empty sets,
  - changing set 2 updates later sets that still carried the previous auto-filled value,
  - adding a new set inherits the nearest previous set weight.
- Created project skills outside the `cerebro-site` git repo:
  - `skills/pt-voice-phase-rebuild-orchestrator`
  - `skills/pt-phase-rebuild-history-reader`
  - `skills/pt-phase-rebuild-programme-writer`
  - Root `AGENTS.md` now documents this chain.

Deployment:
- Deployed `rebuild-programme-phase` ACTIVE v1 to Supabase project `otcnrkfvgyvwolironoz`.
- Redeployed `recalculate-percentage-loads` ACTIVE v9.

Verification:
- Skill validation passes for all three new skills.
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- `git diff --check` passes from `cerebro-site`.
- Targeted ESLint on the touched large UI files is still blocked by pre-existing React compiler lint errors in `ClientPortal`, `PTProgrammeEditView`, and `PTSessionsView`; no new build blocker remains.

Notes:
- No live authenticated browser generation was run because it would call Anthropic and potentially create real exercise cards for a real client.
- `rebuild-programme-phase` is intentionally JWT-protected by default; do not add it to `verify_jwt = false` unless there is a server-to-server caller.

### M & L dictation state race fix (2026-06-22, LATEST)

Pedro reported that tapping `Record voice note` made the button flash between recording/original states and end back at the original state immediately, as if double-clicked.

Root cause:
- Starting a new Web Speech recognizer first stops the previous recognizer.
- The previous recognizer's delayed `onend` callback could still call `setMlVideoListeningKey(null)` after the new recognizer started.
- That stale callback cleared the new recording state almost immediately.

Shipped:
- `recognition.onerror` and `recognition.onend` now ignore stale recognizer instances unless they are still the active `mlVideoSpeechRef.current`.
- Added a `capturedTranscript` flag so stop/end messages distinguish between a successful dictation stop and an immediate/no-words stop.

Verification:
- `npx tsc --noEmit` passes.
- `npm run build` passes.

### M & L video note recording button + contrast fix (2026-06-22, LATEST)

Pedro reported that the video-note record icon in the M & L dossier could not be clicked and that some buttons had white text on a white/light background.

Shipped:
- `Record voice note` buttons inside the M & L movement video notes are now larger solid controls with explicit `title` and `aria-label`.
- Browser dictation start now handles failures instead of silently doing nothing:
  - shows `Starting microphone...`,
  - shows `Recording video note. Speak now, then press Stop recording.` when active,
  - shows a clear Chrome microphone permission / type-instead message if Web Speech errors.
- Added a guard so a previous speech recognizer cannot clear the current recognizer state if Pedro switches movement rows quickly.
- Added M & L dossier-specific button classes in `app/globals.css` so record, load video, save video note, generate PDF, and open PDF controls keep readable colors across normal/hover/disabled/recording states.
- This specifically avoids the global liquid-dashboard `.text-white` / `hover:bg-white` cascade that could produce white text on light backgrounds.

Verification:
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- `git diff --check` passes.

### M & L note/video restore + permanent loader fix (2026-06-22, LATEST)

Pedro could not see Anne-Maree's M & L videos/notes after earlier clicking the old `Done` action. Root cause:
- The old `Done` button had marked all Anne-Maree M & L assessment notes `is_active = false`.
- The client profile server page only fetched `pt_client_notes` with `is_active = true`.
- The video paths and Pedro movement notes were still in Supabase, but hidden from the page query.

Shipped:
- Restored Anne-Maree's M & L assessment notes in production:
  - client id `aa13e098-b21d-4971-92e2-b6892d4c63f7`
  - 4 M & L notes active again
  - final M & L rows contain 15 movements each, 7 videos each, and saved movement notes.
- `app/dashboard/pt/clients/[id]/page.tsx` now fetches:
  - active notes as before,
  - plus all M & L assessment notes for the client using `contains('context', { source: 'ml_assessment' })`, regardless of `is_active`.
- The two result sets are merged by note id and sorted by created date, so M & L evidence stays visible even if an old inactive row exists.

Verification:
- Supabase SQL confirmed Anne-Maree has `ml_note_count = 4` and `active_ml_note_count = 4`.
- `npx tsc --noEmit` passes.
- `npm run build` passes.

### M & L persistent dossier + research-backed PDF workflow (2026-06-22, LATEST)

Pedro flagged the M & L dossier screenshot where the progress bar said `PDF ready` but the detail said AI generation timed out or failed. That is a degraded/fallback success, not a clean AI success. Pedro also clicked `Close` and thought the notes/videos disappeared, and he asked for the generated document to follow a new order: who the person is, issues found, muscles needing attention, what is happening, research context, best approach forward, exercises, and what Pedro should be aware of.

Shipped:
- The top M & L dossier on `/dashboard/pt/clients/[id]` is now permanently expanded. The `Close/Open` toggle is gone, so assessment notes, video review notes, and generated documents stay visible on the profile.
- Removed the `Done` hide/archive action from M & L assessment notes inside the dossier so Pedro cannot accidentally make those notes disappear from the active profile view.
- Existing/generated docs now distinguish clean AI PDFs from fallback PDFs:
  - header badge shows `Fallback PDF` when the source document has `analysis.generation_mode = fallback`,
  - progress state uses amber warning styling and `Fallback PDF ready`,
  - generated document list says `Fallback PDF ready` instead of plain `PDF ready`.
- `generate-ml-client-profile` Edge Function now follows the new document order and includes a bounded Anthropic `web_search` pass (max 3 searches) for general evidence context tied to recorded findings. It does not diagnose or infer from video paths alone.
- AI timeout increased from 45s to 85s to give the research + longer document enough room before falling back.
- Fallback Markdown now uses the same section order and explicitly says AI/research was unavailable, instead of looking like a full intelligence document.
- Created new project skill `skills/pt-ml-pdf-generation-workflow` using the skill-creator workflow. Updated root `AGENTS.md`, `pt-ml-client-intelligence-orchestrator`, and `pt-ml-profile-document-writer` so future agents use the same durable PDF flow and section order.
- Deployed Supabase Edge Function `generate-ml-client-profile` to project `otcnrkfvgyvwolironoz`.

Verification:
- `python3 .../quick_validate.py skills/pt-ml-pdf-generation-workflow` passes.
- `python3 .../quick_validate.py skills/pt-ml-client-intelligence-orchestrator` passes.
- `python3 .../quick_validate.py skills/pt-ml-profile-document-writer` passes.
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- `git diff --check` passes.
- No live regeneration test was run because it would create another real client document/PDF on Anne-Maree's profile.

### M & L movement video note review (2026-06-22, LATEST)

Pedro asked to watch the saved M & L movement videos from the client profile, record voice notes while reviewing them, save those notes against the videos, then generate the PDF from all assessment notes plus the video notes.

Shipped:
- The top client-profile `M & L` card now embeds each saved movement video inside the assessment note instead of only opening it in a new tab.
- Each movement row has a `Load and play video` control, a browser dictation button for `Record voice note`, an editable note field, and a `Save video note` button.
- Saved video notes update the existing final M & L `pt_client_notes.context.movement_assessment_summary.movements[].notes` field. No new table or migration was needed.
- Generate/Regenerate M & L PDF now refuses to run when a video note has unsaved changes, so Pedro does not accidentally create a stale PDF.
- The existing PDF route already reads `movement_assessment_summary.movements[].notes` into the Movement Video Notes Appendix, so saved review notes are included on the next PDF generation.

Verification:
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- `git diff --check` passes.
- Targeted ESLint on `PTClientDetail.tsx` is still blocked by pre-existing React compiler lint issues in that large file (`set-state-in-effect`, `Date.now()` purity, unescaped apostrophe, plus warnings). No new build blocker was introduced.

### M & L Client Intelligence PDF export (2026-06-19, LATEST)

Pedro asked for Anne-Maree's client profile to have a button that turns the notes from the completed M & L assessment, including movement video notes, into a structured PDF document.

Shipped:
- Client profile "Generated intelligence documents" section now appears when a final M & L assessment exists, even if no generated document exists yet.
- New "Generate M & L PDF" button:
  - calls the deployed `generate-ml-client-profile` Edge Function for the latest final M & L note,
  - creates a fresh evidence-based Markdown intelligence document in `pt_client_documents`,
  - calls a new protected Next route to convert that document into a PDF,
  - uploads the PDF to the private `pt-client-docs` bucket,
  - stores the PDF path in `pt_client_documents.storage_path`,
  - opens a one-hour signed URL in a new tab.
- Existing generated profile documents now show "PDF ready" and an "Open PDF" button when `storage_path` exists.
- New Next API route: `app/api/pt/ml-client-profile-pdf/route.ts`.
  - Requires an authenticated Pedro/admin dashboard session.
  - Uses service-role access only server-side.
  - Reads the generated profile document and linked final M & L assessment note.
  - Appends a Movement Video Notes Appendix from `movement_assessment_summary.movements` so Pedro's video review notes are explicitly in the PDF.
- New PDF renderer utility: `utils/pt/ml-client-profile-pdf.ts`.
  - Uses `pdf-lib`.
  - Normalizes smart punctuation to ASCII-safe text.
  - Uses rectangle dividers rather than `drawLine`, because local `pdf-lib` validation rejected `drawLine` and array page sizes in the direct Node runtime.

Verification:
- `npx tsc --noEmit` passes.
- `npx eslint app/api/pt/ml-client-profile-pdf/route.ts utils/pt/ml-client-profile-pdf.ts` passes.
- `npm run build` passes.
- Generated a throwaway sample PDF from the new renderer and validated with `pypdf`: one page, expected sections, and `MOVEMENT VIDEO NOTES APPENDIX` with video notes present.
- Poppler tools (`pdftoppm`, `pdfinfo`) are not installed locally, so visual PNG render QA could not be performed in this environment.
- Full targeted ESLint on `PTClientDetail.tsx` is still blocked by pre-existing React compiler lint violations in that large file (`set-state-in-effect`, `Date.now()` purity, existing unescaped apostrophe, etc.).

### M & L Assessment coach tab (2026-06-18, LATEST)

Pedro asked for the operational page he uses after a client books the public Movement Assessment. New route:
`/dashboard/pt/ml-assessment`, shown in the PT nav immediately after "PT Sessions" as "M & L Assessment".

Shipped:
- Mobile-first three-part workflow:
  - Part 1 Chat: Pedro selects the client, sees name/DOB/age/date, PAR-Q status, booked assessment, client notes, goals, and PAR-Q coach notes. Each question has Record voice -> live text plus Pedro notes.
  - Part 2 Lifestyle & Context: exact questions Pedro provided, each with Record voice -> live text plus Pedro notes, then the close-the-conversation script.
  - Part 3 Movement Screening: general posture observation fields plus every movement from Pedro's brief, including all hip sub-tests.
- Browser speech recognition is wired per answer field and per movement review note. It uses Web Speech (`SpeechRecognition`/`webkitSpeechRecognition`) with interim results, so text updates while Pedro/client speaks. Fallback message tells Pedro to use Chrome/Android or the phone keyboard mic if the browser blocks Web Speech.
- Movement video recording uses `getUserMedia` + `MediaRecorder`. Each movement opens the camera, records, and uploads to the private `pt-client-docs` bucket as soon as Pedro taps stop.
- Part 1 and Part 2 each save a structured `pt_client_notes` row with `context.source = 'ml_assessment'`.
- Finish saves the full chat/lifestyle/movement/video payload to the client profile and calls `update-client-brain` with `movement_assessment_summary` so programme generation can read it.
- Client profile Notes now render M & L assessment rows with stage, saved date, video count, answers, general observations, movement notes, and "Open video" signed links.
- Supabase migration `20260617235915_ml_assessment_video_storage.sql` updates the existing private `pt-client-docs` bucket to allow video MIME types and raises its file limit to 500MB. Applied live through Supabase MCP.

Latest refinement:
- Part 3 general observations are now yes/no pill buttons for head position, shoulder height, spinal curves, hip level, knee alignment, and foot position.
- Each posture item has its own notes field underneath, and saved client-profile rendering supports both the new yes/no+notes shape and older text-only saves.
- Movement video capture now requests a portrait camera stream and renders recording/playback in a portrait 9:16 frame.
- Saved movement videos show a delete button beside the Saved label; deleting removes the object through Supabase Storage API and clears the video from the current draft.
- Finish now has a duplicate-submit guard, shows an "Assessment completed" confirmation after the final save, links to the client profile, returns Pedro to Part 1, and clears all Part 1/2/3 draft fields/videos ready for the next assessment.
- Finish now also triggers the deployed `generate-ml-client-profile` Edge Function in the background. It reads the exact final M & L note id, latest PAR-Q/intake note, client profile, client brain, exercise/lifestyle/nutrition docs, then stores a Markdown "M & L Client Intelligence" profile document in `pt_client_documents`.
- Client profiles now load `pt_client_documents` profile rows and show a "Generated intelligence documents" section with expandable document text.
- Project skills created outside the `cerebro-site` repo: `pt-ml-client-intelligence-orchestrator`, `pt-ml-evidence-extractor`, `pt-ml-findings-interpreter`, and `pt-ml-profile-document-writer`. Root `AGENTS.md` now documents this chain.
- Supabase function deployment verified with `supabase functions list`: `generate-ml-client-profile` ACTIVE v1, updated 2026-06-18 01:48 UTC.

Verification:
- `npx tsc --noEmit` passes.
- Targeted ESLint passes for `app/dashboard/pt/ml-assessment/MLAssessmentView.tsx`; full targeted lint on client detail is still blocked by pre-existing React compiler lint violations in that large file.
- `npm run build` passes.
- Skill validation passes for the new M & L client intelligence skills.
- Supabase security advisors show only existing unrelated warnings: `pg_net` in public, service-role-only permissive policies, leaked-password protection disabled.
- Supabase performance advisors show existing broad DB hygiene warnings; none were introduced by this feature.

Important caveat:
- Browser voice transcription depends on Web Speech support and microphone permission. Chrome desktop/Android is the best path. iOS browser support can be inconsistent, so Pedro should test on the actual phone/browser he plans to use before relying on it in-session.

### Movement Assessment page fixes (2026-06-16, LATEST)

Pedro reported several issues on the public `/movement-assessment` flow. Root causes found and fixed:

1. **Page-2 redirect + booking never saved (the big one).** `submitBooking()` read the signature from
   `canvasRef.current.toDataURL()`, but the step-1 JSX (incl. the `<canvas>`) is unmounted once `step===2`,
   so `canvasRef.current` was `null` → empty signature → `setStep(1)` early-return *before* the POST ever fired.
   That single bug caused both "redirected to first page" and "booking did not save". Fix: capture the signature
   into `signatureDataUrl` state in `continueToCalendar()` (page 1 → 2) and use that in `submitBooking()`;
   `clearSignature()` clears it too. (`app/movement-assessment/MovementAssessmentBooking.tsx`)

2. **Missing available slots.** `generateMovementAssessmentSlots` used a 50-min fit + `slot_duration_minutes`
   step, which dropped the last slot in each availability window vs the coach/client booking calendar.
   Rewrote it to mirror `PTBookingsView.generateSlotsForDay` exactly: `duration = session_duration_minutes`,
   `step = duration + buffer`, fit `minute + duration <= windowEnd`. Verified in-browser: morning 9:30/10:20/11:10
   and afternoon 2:30/3:20/4:10 now all show (50-min step). (`utils/pt/movement-assessment-booking.ts`)

3. **PAR-Q now saved as a PDF on the client profile.** Added `pdf-lib` + `utils/pt/parq-pdf.ts` (builds an A4
   PAR-Q with answers, consent, embedded signature PNG, booking time). The book route generates it, uploads to
   the existing `pt-client-docs` bucket at `${client.id}/parq/<ts>-par-q.pdf`, and stores `parq_pdf_path` in the
   movement-assessment note `context`. `PTClientDetail` renders an "Open signed PAR-Q (PDF)" button (signed URL,
   same pattern as the client document download). NOTE: per Pedro's choice, the PDF/client/booking are all saved
   on the page-2 booking submit (not on page-1 completion).

4. **Thank-you page (step 3).** Now the 3-line confirmation Pedro asked for: "Thank you, {first}." / "You are
   booked in." / "{date} · {time}" + a line that a confirmation email was sent.

5. **Client confirmation email.** Book route now sends the client a booking-confirmation email and Pedro a coach
   notification via Resend (`RESEND_API_KEY` is in `.env.local`; falls back silently if unset). Uses
   `RESEND_FROM_PEDRO_NOTIFY` (falls back to onboarding@resend.dev) - set a verified-domain from address in Vercel
   env for production. Coach notify goes to `COACH_NOTIFY_EMAIL`/`PEDRO_EMAIL` (fallback pedro@cerebroai.au).

6. **Calendar.** Per Pedro's choice, "in-app calendar only" (no Google sync). Assessment bookings already insert
   into `pt_booking_appointments` so they appear in `/dashboard/pt/bookings`; once the signature bug was fixed the
   appointment actually persists. Added an indigo "Movement assessment" label to those appointment blocks in the
   coach calendar (detected via the `notes` prefix) so Pedro can tell assessments from normal sessions.

Verification: `npx tsc --noEmit`, `npm run build`, and targeted ESLint all pass. In-browser smoke test on
`http://localhost:3000/movement-assessment` confirmed page-1 → page-2 no longer bounces and slots render. The final
booking submit was NOT executed against live data (it would create a real client/appointment + send real emails) -
Pedro to run one real booking to confirm the PDF + email + calendar end-to-end.

TODO for Pedro: ensure `RESEND_API_KEY` (and ideally `RESEND_FROM_PEDRO_NOTIFY`, `COACH_NOTIFY_EMAIL`) are set in
the Vercel project env so the confirmation email sends in production.


### Solid dashboard dropdown panels (2026-06-16, LATEST)

Pedro flagged screenshots from the PT programme editor where dropdown/autocomplete backgrounds looked nearly transparent under the liquid-glass dashboard styling.

Fix in `app/globals.css`:
- Strengthened `.no-glass` selectors with `.liquid-dashboard main .no-glass` so they beat the higher-specificity liquid panel selector on dashboard surfaces.
- Changed exercise autocomplete dropdowns and their row buttons from off-white/glass-looking fills to explicit `#ffffff`.
- Kept hover feedback with a subtle solid `#f3f1ea` row fill.
- Added a real shadow to no-glass panels so white dropdowns stay legible over busy dashboard content.

Verification:
- Scoped CSS diff reviewed.
- Full build not run for this tiny CSS-only patch because the working tree already contains unrelated movement-assessment/package changes.

### Coach booking calendar click-to-book modal (2026-06-16, LATEST)

Pedro asked for `/dashboard/pt/bookings` to book directly from calendar slots. The coach calendar now generates clickable open session slots inside each active availability window. Clicking a slot opens a centered booking popup where Pedro selects the client, confirms/edits the datetime, selects repeat count, and books through the existing `manage-pt-booking` Edge Function.

Implementation notes:
- Existing booked appointments still render above open slots and remain clickable for Mark done / Cancel.
- Open slots are generated from `pt_booking_availability` using `session_duration_minutes` plus buffer/cadence rules.
- Slots that overlap active appointments are hidden, so Pedro does not get duplicate click targets over booked times.
- The old right-rail manual booking form remains as a fallback.

Verification:
- `npx eslint app/dashboard/pt/bookings/PTBookingsView.tsx` passes.
- `npm run build` is currently blocked by unrelated uncommitted client-detail changes: `PTClientDetail` props do not include `loginEvents` / `lastSignInAt` while `page.tsx` passes them.
- Browser route `/dashboard/pt/bookings` redirected to `/login` in the automated browser, so logged-in click-through could not be completed here.

### Dashboard liquid divider padding fix (2026-06-16, LATEST)

Pedro flagged the PT client detail page screenshot where "Notes" and "Client profile document" looked like padding-less cards. Root cause was the global liquid-glass selector:
- `.liquid-dashboard main [class*="border-black/8"]` and `[class*="border-black/10"]` matched divider-only sections like `border-t border-black/8 pt-6`.
- Those dividers got glass background, radius, shadow, and blur but no left/right padding, making headings/content look flush and broken.

Fix in `app/globals.css`:
- Tightened the border-card part of the liquid selector to require an actual all-sides `border` class:
  - from `[class*="border-black/8"]`
  - to `[class~="border"][class*="border-black/8"]`
- Same for `border-black/10`, for both `.liquid-dashboard` and `.client-liquid`.
- Result: real tiles/cards (`border border-black/8`) still get liquid glass; divider-only sections (`border-t border-black/8`) stay flat and keep normal spacing.

Verification:
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- Browser QA against local stylesheet: injected dashboard fixture showed `border-t border-black/8` has transparent background, no radius/shadow, and no matching liquid panel rule; `border border-black/8` still has liquid glass card treatment and padding.
- The actual PT client detail route is admin-auth gated in the automated browser, so verification used the real compiled stylesheet with a minimal fixture matching the failing classes.

### Client liquid button single-tap fix (2026-06-16, LATEST)

A client reported that after finishing a workout, tapping Save/Finish made the button turn white and required a second tap. Root cause was the global liquid-glass CSS:
- `.client-liquid .bg-black:hover` inverted every black CTA to white on hover. Touch browsers can persist hover on tap, which made primary buttons look like the first tap only changed state.
- `button[class*="bg-white"]` also matched Tailwind classes like `hover:bg-white`, so black CTAs carrying a hover utility could be treated as white/glass buttons.

Fix:
- Added `touch-action: manipulation` and transparent tap highlight to liquid buttons/links.
- Scoped the white hover inversion to real hover devices only: `@media (hover: hover) and (pointer: fine)`.
- Added a touch/coarse-pointer override so black client CTAs stay black during sticky hover.
- Changed the white-button liquid selector from substring matching (`class*="bg-white"`) to exact utility matching (`class~="bg-white"`) so `hover:bg-white` no longer trips it.
- Added a `savingWorkout` early return in `finishWorkout()` to prevent duplicate workout-log inserts from rapid double taps.

Verification:
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- Browser QA on `http://localhost:3000/client-login`: injected `.client-liquid` black CTAs with both `hover:bg-white` and the real workout finish class stay black at rest; `touch-action: manipulation` is applied; one click fires one handler call. The actual client portal remains auth-gated, so this was a global CSS behavior test rather than a logged-in workout save.

### Board-view divider alignment (2026-06-12, LATEST)

The "drag exercises between days" board (PT programme editor) now lays each day column out as a
CSS **subgrid** so every divider-delimited "band" shares a row across all columns - so the dotted
lines line up horizontally across Day 1..N, with a gap between blocks and whitespace where a day has
fewer/shorter blocks (Pedro picked "every block row" alignment).
- New helper `groupBands()` in `utils/pt/programme.ts` (groups a day's exercises by `startsNewBand`).
- Applied identically to all three board renderers: `programmes/[id]/edit/PTProgrammeEditView.tsx`,
  `programmes/template/[id]/edit/PTProgrammeTemplateEditView.tsx`, `programmes/new/PTProgrammeWizard.tsx`.
- Each column: `display:grid; grid-template-rows: subgrid; grid-row: 1 / span (maxBands+1)`. Parent grid
  defines `auto repeat(maxBands, auto)` rows (row 1 = day header). Dashed divider = `border-t border-dashed`
  + `mt-2 pt-2` on bands after the first.
- `groupBands()` is now RENDER-ONLY grouping (Pedro's choice - does NOT touch stored data, which has dirty
  superset_ids on older programmes): every section except Workout collapses to one tight block (warm-up /
  metcon / stretches); the Workout section is paired into supersets of two BY POSITION (ignores superset_id).
  So each day shows: Warm-Up block -> divider -> superset 1 (2 ex) -> divider -> superset 2 -> ... Verified
  the grouping against the messy programme 3ab8403c (4 bands/day, aligned). Caveat Pedro accepted: the board's
  positional pairing can differ from what the superset editor (PTDayEditor, reads real superset_id) shows.
  tsc clean. NOT yet eyeballed by Claude (couldn't reach Pedro's authed session) - Pedro to confirm on refresh.

### Stripe session payments (2026-06-11)

### Stripe session payments (2026-06-11, LATEST)

Clients now pay for PT sessions in-app. When a client books with no open credits, a top-up popup
offers 4 packs (1=$110, 2=$220, 5=$525, 10=$1000) payable by Apple Pay / Google Pay / card. The card is
saved; the next top-up is a one-tap re-charge. Sessions are credited automatically on payment.

Shipped (code complete, build + tsc green; NOT deployed yet):
- Migration `20260611000000_stripe_payments.sql`: adds `pt_clients.stripe_customer_id` + `last_pack_size`;
  new `pt_payments` table (UNIQUE `stripe_payment_intent_id` = idempotency guard) with RLS (client reads own, admin all).
- Edge fn `manage-pt-payment` (JWT-auth): `create_topup_intent` (ensures Stripe customer, makes PaymentIntent
  at SERVER-side price, setup_future_usage off_session, returns saved_card if any) and `confirm_topup`
  (verifies PI succeeded, credits idempotently).
- Edge fn `stripe-webhook` (verify_jwt=false, Stripe-signature verified): `payment_intent.succeeded` → credit.
  Added to config.toml.
- `_shared/credit-pack.ts`: the ONE idempotent `creditPack()` used by both confirm_topup and the webhook.
  Inserts pt_payments first (23505 = already credited → no-op), then bumps sessions_remaining, writes
  pt_session_ledger `pack_added`, sets last_pack_size, emails the client. Server-authoritative price map.
- Both Stripe clients use `Stripe.createFetchHttpClient()` (Deno) + webhook uses `createSubtleCryptoProvider()`.
- `manage-pt-booking` changes: createBooking now enforces an OPEN-CREDITS guard (sessions_remaining minus
  active future holds >= occurrences) instead of `sessions_remaining<=0` - closes the overbooking gap and is
  the server backstop behind the popup (returns code `insufficient_sessions`). Low-session reminder emails
  (2/1/0 in complete + no_show + cron sendSessionAlerts) are now gated by `shouldSendCreditReminder` =
  `last_pack_size >= 5` (only 5/10-pack buyers get nagged; 1/2-pack buyers don't). last_pack_size added to
  the relevant selects + PTClientRow.
- Frontend: `app/client/TopUpModal.tsx` (pack select → Stripe Payment Element for new card OR one-tap saved
  card → success), wired into `ClientPortal.tsx`: "Buy sessions" button by the Pack/Held/Open cards; booking
  slots are now always clickable (canBook=true) so tapping one at 0 credits routes through the popup;
  `bookSelectedSlot` pre-checks open credits and opens the top-up, then auto-continues the booking on success.
  Added `@stripe/stripe-js` + `@stripe/react-stripe-js`. `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` added to .env.local.

GO-LIVE RUNBOOK (Pedro must do, test mode first):
1. ROLL the Stripe secret key - the old `sk_live` was pasted in chat and is compromised.
2. `supabase secrets set STRIPE_SECRET_KEY=sk_test_... STRIPE_WEBHOOK_SECRET=whsec_...` (use test keys first;
   set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY to the matching pk_test for testing).
3. Apply the migration (prior sessions used Supabase MCP `apply_migration` due to remote migration-history drift).
4. Deploy fns: `supabase functions deploy manage-pt-payment stripe-webhook manage-pt-booking --use-api`.
5. Stripe dashboard: add webhook endpoint → the deployed stripe-webhook URL, event `payment_intent.succeeded`
   (copy its whsec into step 2); register `cerebroai.au` under Payment Methods → Apple Pay.
6. Test with card 4242 4242 4242 4242 (new card saves; second buy = one-tap). Then swap to live keys + live
   webhook + re-register Apple Pay domain in live, do one small real purchase.
NOTE: deploying manage-pt-booking before the secret is set means a client hitting the Open-guard sees
"Top up to book" but the popup can't charge - so set secrets BEFORE/at the same time as the deploy.

### Weekly wrap-up email feature (2026-06-10, LATEST)

### Weekly wrap-up email feature (2026-06-10, LATEST)

New Spotify-Wrapped-style weekly email to clients (Sunday ~8am Sydney) recapping workouts, nutrition, PBs, with a short AI recap. Pedro designs it once in the email builder using {{week.*}} tags; the same template applies to every client, each tag resolved per-recipient at send time.

Shipped + DEPLOYED to Supabase project otcnrkfvgyvwolironoz:
- Migration `20260610000000_weekly_wrapup.sql` (applied): `pt_client_weekly_wrapup` table (PK client_id+week_start, RLS mirrors brain-reports), `pt_clients.receive_weekly_wrap_up_email` bool default true, and pg_cron job `pt-weekly-wrapup` `0 22 * * 6` (Sat 22:00 UTC = Sun ~8am Sydney) calling the edge function with the cron bearer.
- Edge function `send-weekly-wrapup` (deployed, verify_jwt false; custom auth: cron token OR Pedro/admin JWT). Modes: scheduled (loop opted-in clients, dedup via pt_notification_log metadata.week_start, send HTML via Resend, log) and preview ({client_id} -> renders with that client's real week + AI recap, sends [PREVIEW] to Pedro). Metrics: volume, top exercise, biggest lift, PBs (Epley vs pt_client_1rm_results baselines), nutrition adherence vs pt_client_nutrition_doc.daily_targets, consistency streak, energy. AI recap via claude-haiku-4-5-20251001. Requires a status='live' `weekly_wrap_up` template before it sends (else safe no-op).
- `PTEmailsView.tsx`: new `weekly_wrap_up` workflow + starter design; WRAP_UP_TOKENS tag palette (click to copy) + WRAP_UP_PREVIEW_SAMPLES; previewTokenValue resolves {{week.*}} samples; "Preview with a client's real week -> Send preview to me" control (client dropdown + invoke preview mode).
- `app/client/SettingsTab.tsx`: "Email notifications" section with a wrap-up on/off toggle (direct pt_clients update via the existing client_update_own_profile RLS policy; default on).

NEXT (Pedro): in PT dashboard -> Emails -> "Weekly client wrap-up", design the email with the {{week.*}} tags, use "Send preview to me" to check it with a real client, then "Make live" to start the Sunday sends. Tag syntax {{week.xxx}}; full list in WRAP_UP_TOKENS / the send-weekly-wrapup metrics. A `pt-wrapup-tag` skill is being created to wire any future new tag end-to-end.

Verification: tsc + build green; migration applied; function deployed; scheduled invoke returned the safe "no live template" guard (week_start 2026-06-08); cron job active. Per-client data path validates when Pedro previews with a live template.

### Manual client programme phase movement (2026-06-10, LATEST)

Pedro needed to move Analise forward to the 1RM testing phase before tomorrow's session, record 1RM numbers, then move her into Hypertrophy. Previously active phase was inferred from workout logs, and `current_week/current_block_index` did not include a phase cursor, so there was no reliable admin control to move a client forward/back.

Shipped:
- Added `current_phase_index` to live Supabase `public.pt_program_assignments` and local migration `supabase/migrations/20260610072245_programme_phase_cursor.sql`.
  - `supabase db push --yes` was blocked by pre-existing remote migration-history drift: many remote migration versions are missing locally.
  - Applied the additive DDL via Supabase MCP `apply_migration`; verified the live column exists and is nullable.
- `utils/pt/programme.ts`: centralized progress helpers:
  - `calcPhaseProgress`
  - `resolveActivePhaseIndex`
  - `getCursorForWeeksLeft`
  - `getWeeksLeftFromCursor`
  - `getCursorUpdateAfterWorkout`
  - `phaseIsComplete`
- Programme edit screen (`app/dashboard/pt/programmes/[id]/edit/PTProgrammeEditView.tsx`):
  - New "Client position" panel above Phases.
  - Pedro can pick active phase, set weeks left, move back/forward one phase, then save.
  - Weeks-left only changes the assignment cursor; it does NOT shorten or rewrite the programme JSON.
  - Cursor is only persisted for older assignments if Pedro touches the control, so ordinary saves do not accidentally pin legacy clients back to phase 1.
  - Cursor changes write a `pt_events` row with `event_type = programme_position_changed`.
- Client workout portal and coach PT-session logger now prefer `current_phase_index` when present, but fall back to log inference for older assignments without a manual cursor.
- Workout completion now updates `current_phase_index/current_block_index/current_week`; one-day testing phases can advance naturally after being logged.
- New programme assignments start at `current_phase_index = 0`, `current_block_index = 0`, `current_week = 1`.
- 1RM results flow on client detail:
  - Fixed existing schema mismatch: UI was inserting `tested_weight_kg/tested_reps`, but live `pt_client_1rm_results` stores `load_kg/reps`.
  - Existing loaded results are normalized back into UI shape for display.
  - After saving 1RM results, the modal offers an explicit "Move to Phase 2 - Hypertrophy" style action when a next non-test phase exists. It does not auto-advance.
- Programme list and several Edge Function programme-context selects now include/use `current_phase_index`.

Verification:
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- Live DB column verified through `information_schema`.
- Supabase advisors checked after DDL. Only pre-existing project-wide warnings appeared:
  - security: `pg_net` extension in public, leaked password protection disabled.
  - performance: existing unindexed FK / RLS / duplicate-index warnings; no issue specific to `current_phase_index`.
- Browser smoke: local dev server started at `http://localhost:3000`; `/dashboard/pt/programmes` redirects to `/login` in the in-app browser, so visual QA remains auth-gated.

### Fix nutrition screen width regression (2026-06-10, LATEST)

The previous change (collapsing the Nutrition Journey) switched the NutritionTab root container from `space-y-4` to `flex flex-col gap-4` so `order-last` could move the journey to the end. But the cards use `mx-auto`, and in a flex column `margin:auto` overrides `align-items:stretch`, so every card hugged its content and shrank/narrowed. Pedro flagged "all looks smaller now".

Fix in `app/client/NutritionTab.tsx`:
- Reverted root container back to `space-y-4` (full-width cards restored).
- Removed the `order-last`/flex hack and instead PHYSICALLY moved the Nutrition Journey JSX block to the end of the screen (after the meals section, before the modals).
- Kept the earlier improvements: collapsed one-liner (`line-clamp-1`, week count in the eyebrow) and the full summary shown in the expanded panel.

Lesson: don't switch a `space-y-*` block container to flex when children rely on `mx-auto` for width; it collapses them to content width. Move JSX instead.

Verification: `npx tsc --noEmit` and `npm run build` pass (exit 0). No live visual QA (client portal auth-gated).

### Client Nutrition Journey collapsed + moved to end (2026-06-10, LATEST)

Olga's nutrition screen showed the full nutrition-strategy essay expanded near the top, filling the viewport. The block was already a collapsible toggle (`nutritionJourneyExpanded` defaults false) but the collapsed "one-liner" rendered the entire `client_summary` with no truncation, and it sat right after "Track your food".

Fix in `app/client/NutritionTab.tsx`:
- Collapsed state is now a true one-liner: `line-clamp-1` on the summary preview, with the week count moved into the eyebrow ("Nutrition journey · N week plan").
- Moved it to the END of the nutrition screen: root container changed `space-y-4` -> `flex flex-col gap-4` and the journey block given `order-last` (visually last without relocating the large JSX; modals are fixed overlays so unaffected).
- Expanded panel now shows the full summary text (so she can read it) above the phase timeline; cleaned the panel border/padding.

Verification: `npx tsc --noEmit` and `npm run build` pass (exit 0). No live visual QA (client portal is auth-gated).

### Compact client workout logger (2026-06-10, LATEST)

Pedro wanted the client-side workout logging screen to stop showing one huge exercise per viewport. The existing full-screen exercise logger remains available as `Classic`, but the new `Compact` mode is now the default.

Shipped in `app/client/ClientPortal.tsx`:
- Added `Compact / Classic` toggle at the top of the active workout logger. Compact is default, and the client’s last choice is remembered in `localStorage`.
- Compact mode renders dense liquid-glass exercise cards so multiple exercises fit in the viewport.
- Each card has:
  - exercise name and target prescription;
  - circular video button that opens an upward animated video panel;
  - `Track` and `Cues` pill buttons that open downward animated panels.
- Track panels reuse the existing set draft/save flow, previous-set display, and add/remove set controls.
- Cue panels reuse rich library setup cues when available, then programme verbal cues, with existing defaults as fallback.
- Supersets get a subtle connector line and use superset-aware panel behavior: Track can stay open on both exercises in the same superset while other panels close.
- Compact mode separates warm-up from workout with a divider.
- Compact mode uses one final workout note at the end, saved into the existing `pt_workout_logs.notes` and event metadata path. Classic mode keeps the previous per-section note cards unchanged.

Verification:
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- Targeted `npx eslint app/client/ClientPortal.tsx` still fails only on pre-existing file issues (`react-hooks/set-state-in-effect` in nutrition progress/loading effects plus old unused warnings); the new localStorage effect was adjusted so it does not add a lint error.
- Browser QA was blocked because the in-app browser redirected to `/client-login` and no local client test credentials were available in the repo. Dev server was started successfully at `http://localhost:3000`.

### Pattern chips auto-derive from name (2026-06-10, LATEST)

Pedro opened a template board and saw no pattern chips. Cause: the template exercises were created before the pattern field (stored `pattern` is null), AND many library cards carry messy legacy tags ("lower body", "pulling", "glute-focused", and goblet squat even tagged "mobility") rather than the clean pattern slugs, so slug-mapping alone tagged nothing (and would mis-tag).

Fix (display-time resolution, no data migration):
- `utils/pt/patterns.ts`: added `patternFromName(name)` (keyword classifier with single-arm/single-leg detection), `derivePattern(name, tags)` (name first, then slug tags), and `resolvePattern(ex, libById)` used for display: hand-set `ex.pattern` wins, else derive from the exercise name, else the linked library card's name/tags.
- Auto-fill on adding a library exercise now uses `derivePattern` (name-aware) in `PTDayEditor.selectFromLibrary` and `programme.exerciseFromLibrary`.
- Day editor chip + all THREE board views (client edit, wizard, template) now render `resolvePattern(...)`, so every library-linked exercise shows a chip immediately. Removed the old `getMuscleTag` heuristic + its now-unused definitions in the client editor and wizard.
- Tightened the Carry name-match so "Suitcase Squat" resolves to Legs Anterior, not Carry.

Note: name classification is best-effort; a few oddities (e.g. "Hip Flexor Pulls" -> Upper Pull) can be corrected via the day-editor dropdown, which always wins.

Verification: `npx tsc --noEmit` and `npm run build` pass (exit 0). No live visual QA (admin-gated).

### Board view added to the template editor (2026-06-09, LATEST)

Pedro was editing a TEMPLATE (`/dashboard/pt/programmes/template/[id]/edit`) and couldn't find Board view. It never existed there; Board view was only in the client-programme editor (`/programmes/[id]/edit`) and the new-programme wizard (`/programmes/new`). Pedro confirmed he wants it in the template editor too. (Supersedes the earlier "Template editor has no board view" note below.)

Shipped in `app/dashboard/pt/programmes/template/[id]/edit/PTProgrammeTemplateEditView.tsx`:
- New state: `boardView`, `dragEx`, `dragOverDay`, `boardEditExId`.
- Handlers ported from the client editor: `moveExerciseToDay` (shared `moveExerciseBetweenProgrammeDays`), `getBoardMatches`, `patchBoardExercise`, `deleteBoardExercise`.
- "Board view" toggle next to "Select" in the Workouts header (shown when the phase has days).
- Board branch (`boardView ? board : currentDay === null ? list : day-editor`): side-by-side day columns, drag exercises between days, faded section/superset dividers via `startsNewBand`, inline rename / library-match / delete, and the new `ex.pattern` chip via `patternChipClass`. Page widens to `max-w-7xl` in board mode.

Known duplication: the board JSX now lives in THREE files. A future cleanup could extract a shared `<ProgrammeBoard>`, but they differ slightly (select checkboxes, delete-day button, day.focus subtitle), so left inline to avoid risking the two working screens.

Verification: `npx tsc --noEmit` and `npm run build` pass (exit 0). No live visual QA (admin-gated).

### PT exercise library video population (2026-06-09, LATEST)

Pedro asked to add YouTube videos to all exercise cards missing videos after the Markdown exercise-library import.

Shipped:
- Ran `scripts/populate-exercise-videos.py` against live Supabase with the service role key.
- First pass populated `623/637` missing `video_url` rows using `yt-dlp` YouTube search.
- Added reusable fallback search logic in `scripts/populate-exercise-videos.py`:
  - strips parenthetical cues like tempo/Pedro notes for generic exercise searches;
  - expands `RDL` to `Romanian deadlift`;
  - includes curated fallback queries for the 14 exact rows that failed the first pass.
- Second pass populated the remaining `14/14` rows.

Verification:
- Supabase count check now returns `missing_video_count = 0` for `public.pt_exercises where video_url is null`.
- `python3 -m py_compile scripts/populate-exercise-videos.py` passes.
- Note: videos are best-effort YouTube matches intended to fill cards quickly. Pedro can still replace individual videos manually where he wants his own preferred demonstrations.

### Board-view divider lines + pattern chip (2026-06-09, LATEST)

Pedro wanted the Board view (compare days side by side) to draw faded lines dividing the workout into bands (warm-up block, then each superset) so he can scan superset-to-superset across the day columns, using the new pattern tags.

Shipped:
- `utils/pt/programme.ts`: new `startsNewBand(prev, curr)` helper. A band boundary (faded divider before the exercise) occurs when the exercise starts a new section (`section_start`) OR its superset group differs from the previous exercise (covers superset-to-superset and superset-to-standalone). Consecutive standalone exercises stay in one band.
- Board view in BOTH `app/dashboard/pt/programmes/[id]/edit/PTProgrammeEditView.tsx` and `app/dashboard/pt/programmes/new/PTProgrammeWizard.tsx`: render `<div className="my-1 border-t border-dashed border-black/15" />` at band boundaries, and show the new `ex.pattern` chip (coloured via `patternChipClass`) in place of the old `getMuscleTag` heuristic, falling back to `getMuscleTag` when no pattern is set.
- Template editor has no board view (list-only), so unaffected.

Note: dividers are per-column at band boundaries; cross-day alignment is approximate (depends on Pedro structuring days in parallel). True row-locked alignment would require a shared grid that would fight drag-and-drop, so not done.

Verification: `npx tsc --noEmit` and `npm run build` pass (exit 0). No live visual QA (admin-gated).


### Movement-pattern tags in the programme editor (2026-06-09, LATEST)

Pedro wanted to extend the old "upper/lower body" notion into a proper per-exercise movement-pattern tag, shown as a coloured chip in the programme editor when creating/altering/editing any programme, auto-filled from the exercise library and editable.

Canonical taxonomy lives in `utils/pt/patterns.ts` (`MOVEMENT_PATTERNS`): Upper Pull, Upper Pull (Single Arm), Upper Push, Upper Push (Single Arm), Hinge, Hinge (Single Leg), Legs Anterior, Legs Anterior (Single Leg), Legs Posterior, Legs Posterior (Single Leg), Core, Core (Anti-Rotation), Carry, Mobility, Full Body / Power. Pedro's words: `squat` slug → **Legs Anterior**, `hinge` slug → **Hinge**. **Legs Posterior** has no dedicated library slug yet (only the unused `posterior chain` maps to it), so it's available for manual assignment.

Shipped:
- `utils/pt/patterns.ts` (NEW): canonical list, chip colour map (`patternChipClass`), and `patternFromTags()` mapping library slug tags (`upper-push`, `squat`, `hinge-single-leg`, …) → display labels. Single-arm/leg variants win over their bilateral parent.
- `utils/pt/types.ts`: `PTProgrammeExercise` gained `pattern?: string | null`.
- `utils/pt/programme.ts`: `safeExercise` now preserves `pattern` (so it survives load/save); `exerciseFromLibrary` auto-fills it via `patternFromTags`.
- `app/dashboard/pt/programmes/PTDayEditor.tsx`: per-exercise coloured chip + dropdown picker under each row. `selectFromLibrary` auto-fills the pattern (without clobbering a hand-set one). Shared by the new wizard, programme edit, and template edit, so all three get it.

Storage: pattern lives in the programme JSON, no DB migration. The library already stores pattern slugs in `pt_exercises.tags`, so zero re-tagging.

Verification: `npx tsc --noEmit` and `npm run build` both pass (exit 0). No live visual QA (dashboard is admin-gated). NOT yet shown read-only in the coach PT-session logger or client workout view; offered to Pedro as a follow-up.


### Exercise library Markdown import (2026-06-09, LATEST)

Pedro added `Cerebro Knowledge/exercise-library.md` and asked to cross-reference it with the live exercise library, then create cards for missing exercises with videos left for manual upload.

Source document:
- `../Cerebro Knowledge/exercise-library.md`
- UTF-8 Markdown, 48,483 bytes.
- Parsed exactly 682 unique exercise rows from the `- Name | tag [equipment]` format.

Import process:
- Followed the PT exercise import chain.
- Dedupe compared against live `public.pt_exercises` using normalized names:
  - case-insensitive
  - punctuation/hyphen/space variants treated as equivalent
  - `Dumbbell`/`DB`, `Barbell`/`BB`, `Kettlebell`/`KB` aliases treated as equivalent
- Existing live library count before import: 704.
- Existing matches from the document: 41.
- New rows inserted: 641.
- Final live library count: 1,345.

Inserted row shape:
- `video_url = null` for all 641 new rows so Pedro can add videos manually.
- `tags` include `exercise-library-import` and `needs-video`.
- `source = 'ai'`.
- `purpose` stores the document pattern tag.
- `equipment` was inferred from the exercise name first, then the bracketed document equipment, because the document had a few obvious bracket mismatches such as Dumbbell/Kettlebell movements marked `[Barbell]`.
- `cues`, `setup_cues`, `conditions`, `progression_ids`, and `regression_ids` are empty arrays.
- `primary_muscles`, `secondary_muscles`, and `muscles` were generated deterministically from the pattern tag and exercise name.

Verification:
- Aggregate check: `total_exercises = 1345`, `imported_from_document = 641`, `imported_with_null_video = 641`, `imported_needs_video = 641`.
- Normalized re-check against all 682 source names returned `remaining_missing = 0`.
- Spot-checked imported rows show clean display names (`- Pedro`, `+ t-spine` instead of Markdown escapes) and null `video_url`.

### Client workout journey unreached-card opacity (2026-06-09, LATEST)

Pedro wanted the client-side Workout > Your Journey view to make only the current/reached step visually active. Before this, the future phase titles were muted, but the nested week cards for 1RM Testing, Phase 2 Hypertrophy, and Phase 3 Strength still rendered like active white cards.

Shipped:
- `app/client/ClientPortal.tsx`
  - `renderWeekRail()` now derives `isReachedPhase` from active/done state.
  - Current or completed phases keep the full white card, normal week text, milestone dots, and green progress fill.
  - Unreached phases now dim the whole week rail (`opacity-[0.42]`), mute the card border/line/dots, and hide the green fill.
  - Future week/set/% labels are visually greyed out with the card, so they match the muted phase title state until the client reaches that step.

Verification:
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- Browser QA on `http://localhost:3000/client`: expanded Workout > Your Journey for the logged-in local client. Phase 1 Foundation stays fully visible; 1RM Testing, Phase 2, Phase 3, and Retest rails render dimmed. Computed check confirmed active rail opacity `1`, unreached rail opacity `0.42`.
- Targeted `npx eslint app/client/ClientPortal.tsx` still fails on pre-existing file errors at lines 562 and 746 (`react-hooks/set-state-in-effect`) plus existing unused warnings; no new lint class was introduced by this patch.

### Build-wide glass fixes via globals.css (2026-06-04, LATEST)

After the overview pass, Pedro asked to apply the premium treatment across the whole build. Rather than blind-edit ~14 view files (the dashboard is admin-auth-gated and the claude-in-chrome extension was not connected, so no visual verification was possible), the two remaining systemic bugs were fixed GLOBALLY in `globals.css` so every page benefits at once:
1. **Bare `<section>`/`<article>` no longer auto-glass** (admin dashboard). They were becoming padding-less panels with headings flush to the edge and nested card-in-card. Now only `.liquid-panel` or real card classes become panels. Grouping sections go transparent; headings sit naturally. `.client-liquid section`/`article` left intact (client portal not audited yet).
2. **Amber/alert CARDS now get 16px radius + elevation** (matching neutral cards). The neutral panel rule only rounded bg-white/border-black cards and the `a { border-radius: 999px }` rule pilled anchor cards, so amber tiles rendered as sharp rectangles or stadiums. Rule excludes small amber pills via `:not([class*="py-1"]):not([class*="rounded-full"]):not(.liquid-chip)`.
Plus: PTProgrammesView h1 typo "PTProgrammes" -> "Programmes".

Helpers available for any future per-page work: `.cb-card` (force card geometry on a tile/list card), `.liquid-chip` (opt small pills out of glass). See [[project_cerebro_glass_system]] in memory.

Still TODO (needs visual verification, ideally with the Chrome extension connected): per-page leaf-card padding bumps and converting per-section `text-[0.6rem] uppercase tracking-[0.2em]` eyebrows to the cleaner `text-sm font-semibold` SectionHeading style (done on overview, Pedro liked it; 17 files still use the old eyebrow). Lower priority, higher blind-risk, so left for a verified pass.

### PT Overview premium design pass (2026-06-04)

### PT Overview premium design pass (2026-06-04, LATEST)

Pedro asked for a full UI/UX review of the Cerebro dashboard (especially PT Overview) to make it feel premium: padding, breathing room, button text contrast, cards that look good. Ran the `impeccable` skill (audit-first). Audit score was 10/20 (Acceptable). Chosen approach: **refine the glass system (low risk), PT Overview first**. Pedro reviews before rolling the pattern wider.

Root cause found: the `.liquid-dashboard` glass layer in `globals.css` keys off Tailwind class *fragments* (`[class*="bg-white"]`, `[class*="bg-[#fbfbf8]"]`, `[class*="border-black/8"]`) and can't distinguish a page card from a tiny inline pill. So small badges were getting full 20px-radius glass panels + 50px drop shadows ("boxes not looking good").

Shipped (3 files):
- `globals.css`: softened panel shadow (`--liquid-shadow` -> `0 10px 30px -20px rgba(0,0,0,0.28)`), panel radius 20px -> 16px, added a `.liquid-chip` opt-out class (no glass/shadow/blur, 9px radius, subtle bg) for inline lozenges.
- `overview/ClientWeeklyOverview.tsx`: nutrition pills now use `.liquid-chip`; inner divider strips switched to arbitrary-value borders (`border-black/[0.08]`) to dodge the glass selectors; header/row padding bumped (`px-6/8 py-5/6`); cleaner heading hierarchy; status badge kept semantic colors with `rounded-md`.
- `overview/page.tsx`: removed the per-section tiny uppercase eyebrows (11 -> 0; AI-grammar tell), added reusable `StatTile` + `SectionHeading` so both stat grids are identical and headings are consistent legible `text-sm font-semibold`; bumped container/card/section padding; raised faint label contrast; replaced em dashes with `·`; "Assign"/"Plan"/"Check in" labels made legible.

Follow-up commit (same day) after Pedro sent screenshots:
- **Root bug:** amber alert tiles rendered as sharp rectangles (divs, radius 0) or full ellipses/stadiums (anchors, via the generic `.liquid-dashboard a { border-radius: 999px }`), because the glass panel radius only rounds neutral (bg-white/border-black) cards. This is the "yellow ones are ugly".
- **Fix:** added `.cb-card` in `globals.css` (forces `border-radius: 16px !important` + consistent elevation, no background so amber fill survives, beats the anchor pill rule). Applied `.cb-card` to every stat tile and list card in `overview/page.tsx` AND the main dashboard surfaces (`dashboard/page.tsx`, `components/WebsiteStats.tsx`, `components/SocialChannels.tsx`).
- **Padding:** stat tiles -> p-7, list rows -> px-6 py-5, website-stats cards p-4 -> p-6, social cards p-5 -> p-6, empty state px-4 py-3 -> px-6 py-5.

Verification:
- `npx tsc --noEmit` passes (exit 0) on both commits.
- No live browser QA: dashboard is admin-auth-gated and the claude-in-chrome extension was not connected this session. Pedro to eyeball the running app after Vercel deploy.

Next if Pedro approves: roll the same pattern (cb-card geometry, liquid-chip for inline pills, StatTile/SectionHeading consistency, padding scale) across the other PT pages (clients, programmes, messages, exercises) and the client portal (`app/client/ClientPortal.tsx`).

### Client booking calendar display rework (2026-06-03)

Pedro is only available Tuesday and Thursday. He wanted the client-side booking calendar (`app/client/ClientPortal.tsx`, the "Book Pedro" card in the Workout/booking screen) to make that obvious across all three toggles and to span the full working day.

Shipped:
- Extended the day grid to 6am-7pm: `BOOKING_CALENDAR_END_HOUR` 14 -> 19. Affects 3-day and week views (month is unaffected).
- 3-day toggle now always shows **Tuesday, Wednesday, Thursday** of the booking week (`threeDayDays` = Sun+2/+3/+4). Wednesday renders blank because Pedro has no availability that day; Tue/Thu show slots. Slots remain fully data-driven from `pt_booking_availability` (day_of_week).
- 3-day and week toggles both step a full week at a time (`moveCalendar` now always `addDays(±7)`); navigating forward shows the next week's Tue/Thu. Removed the now-unused `advanceWeekday` helper.
- Calendar rail (`renderCalendarRail`) now fits inside the card: `max-h-[65vh] overflow-y-auto` with a `sticky top-0` day-header so it scrolls vertically to 7pm while the weekday labels stay pinned. Week view keeps horizontal scroll on narrow screens.
- Added `pb-24` bottom padding to the booking screen container so the page end has breathing room.
- Month toggle unchanged: 4-week Mon-Fri grid, only Tue/Thu carry slots.

Verification:
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- ESLint on the file shows only pre-existing warnings/errors (lines 5, 277, 506, 562) unrelated to this change.
- No interactive browser QA run this session.


### PT client daily nutrition target editor (2026-06-02, LATEST)

Pedro wanted coach-side calorie and protein editing for every PT client, with automatic carbohydrate and fat recalculation.

Shipped:
- Added an expandable `Edit daily nutrition targets` coach control inside the generic `/dashboard/pt/clients/[id]#weekly-progress` nutrition panel.
- The editor is available for every client because it sits in the shared client-detail component.
- Editing calories automatically rebalances protein, carbohydrates, fat, and fibre.
- Editing protein keeps calories fixed and rebalances carbohydrates and fat. Fibre remains aligned to the calorie target.
- The preview shows calories, protein, carbohydrates, fat, fibre, and the calorie total after gram rounding before Save.
- The macro calculator preserves the client's existing carbohydrate/fat energy split as closely as possible, while enforcing the existing generator ranges: calories `1200-5000`, protein `60-300g`, carbohydrates `100-650g`, fat `50-180g`, and fibre `20-70g`.
- Unsupported target combinations show an error and disable Save.
- Saving updates the shared `pt_client_nutrition_doc.daily_targets` JSON object and refreshes the coach detail route. The same source is used by PT Overview, the client nutrition tab, the client macro widget, and nutrition logging context.
- No migration was needed. Existing admin RLS permits the authenticated coach update.

Stephen verification examples:
- `2390 -> 2200 kcal` previews `131g protein / 275g carbs / 64g fat / 31g fibre`, totalling exactly `2200 kcal`.
- `142g -> 150g protein` keeps `2390 kcal` and previews `290g carbs / 70g fat / 33g fibre`, totalling exactly `2390 kcal`.
- A rollback-only database update check returned Stephen's existing live values unchanged.
- All `11` current PT clients have a nutrition document and daily targets available for editing.

Verification:
- Targeted ESLint passes for the new calculator, editor, and updated weekly panel.
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- Interactive browser QA could not run because no in-app browser backend was connected in this Codex session.

### PT Overview all-client weekly tracking widget (2026-06-02, LATEST)

Pedro wanted the client detail weekly review to be available across the roster and a one-screen overview for checking every client.

Shipped:
- Added a `Weekly client overview` widget to `/dashboard/pt/overview` above Coaching operations.
- The widget renders every PT client in one responsive roster, including clients with no recent logs.
- The first column links each client name directly to `/dashboard/pt/clients/[id]#weekly-progress`.
- The nutrition column shows tracked days out of seven, protein-target hit days, and calorie-range hit days. Missing targets are labelled explicitly.
- The workout column shows workout count and the latest workout title/date within the seven-day window.
- The roster uses the same Sydney calendar-day model as the detail page and fetches one extra day so the UI can trim the exact visible range.
- Tablet and mobile widths use stacked per-client rows. The three-column comparison layout starts at large desktop widths.
- Added the `#weekly-progress` anchor to the generic detail module, so the drilldown works for every client.
- No migration was needed. The Overview widget reads existing nutrition docs, nutrition logs, and workout logs.

Live-data verification:
- All `11` client records appear in the aggregate read.
- The roster includes no-log, nutrition-only, training-only, and mixed-activity client states.

Verification:
- Targeted ESLint passes.
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- Interactive browser QA could not run because no in-app browser backend was connected in this Codex session.

### PT client weekly nutrition and training progress (2026-06-02, LATEST)

Pedro needed a coach-facing view of Stephen Layfield's recent nutrition adherence and workout progress on the PT client detail page.

Shipped:
- Added a `Weekly progress` module to `/dashboard/pt/clients/[id]` before the existing Coaching section.
- Nutrition shows the last seven Sydney calendar days, tracked-day count, protein target hits, calorie-range hits (`+/- 10%`), daily averages, and the configured daily targets.
- Each nutrition day expands to show tracked meals, input type, meal description, estimated macros, calories, and food-item detail.
- Training shows completed workouts, set count, and estimated exercise PBs from the last seven days.
- Each workout expands to show its exercises and logged weight/reps for each set.
- PB detection compares each recent weighted exercise's best estimated Epley 1RM against the client's prior weighted-set history. First-ever exercise logs are not labelled as PBs.
- Recent reads are bounded to eight days so the UI can trim the exact Sydney seven-day range. Historical weighted-set reads are capped at the latest 5,000 rows for PB baselines.
- No migration was needed. The module reads the existing `pt_nutrition_logs`, `pt_workout_logs`, `pt_set_logs`, and `pt_client_nutrition_doc` data.

Stephen live-data verification:
- `39` recent nutrition entries.
- `2` completed workouts.
- `44` recent sets.
- Daily targets are available: `142g` protein and `2390 kcal`.

Verification:
- Targeted ESLint passes for the new component and updated server page.
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- Interactive browser QA could not run because no in-app browser backend was connected in this Codex session.

### PT programmes page hierarchy and template accordions (2026-06-02, LATEST)

Pedro clarified that new client programmes are the primary workflow and templates are secondary.

Shipped:
- Renamed `Client assignments` to `Client programmes`.
- Moved client programme cards above the templates section.
- Renamed the lower section to `Programme templates`.
- Replaced the template card grid with a compact accordion list.
- Increased template title size and row padding so template names scan cleanly.
- Removed the full phase-chip list from templates.
- Each collapsed template row shows the number of assigned clients.
- Expanding a template shows the assigned client names and each assignment status, plus secondary open/delete actions.
- The programmes query now includes `template_id` so assigned-client lists are derived from live assignment data and stay correct after local deletes.

Verification:
- Targeted ESLint passes.
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- Interactive browser QA could not run because no in-app browser backend was connected in this Codex session.

### PT programme assignment card hierarchy (2026-06-02, LATEST)

Pedro asked to simplify the client-assignment cards on `/dashboard/pt/programmes`.

Shipped:
- Client name is now the primary bold heading at the top of each assignment card.
- Programme title sits directly below the client name.
- Assignment status sits directly below the programme title.
- The full list of programme phase chips has been removed from assignment cards.
- Each card now shows one `Current phase` label derived from the assignment workout logs using the same week-block progression rules as the workout flow.
- Delete-confirmation cards preserve the same hierarchy so the layout does not jump when delete is pressed.

Verification:
- Targeted ESLint passes.
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- Local browser visual QA could not run because no in-app browser backend was connected in this Codex session.

### pedroavila.coach real assets + design pass (2026-05-29, LATEST)

Pedro installed two anti-slop frontend skills (`impeccable` and `design-taste-frontend`, both global in ~/.claude/skills) and asked to improve the /coach site using them, wiring in assets from `Design/PedroAvila.Coach Design/` (Google Drive). Note: those Drive files use a narrow no-break space (U+202F) in screenshot names - access via globs, not literal names.

Shipped (commit c7ab670):
- Staged + optimized assets (sips) into `cerebro-site/public/coach/`: pedro-hero.jpg, pedro-portrait.jpg, pedro-training.jpg, powder.jpg, client-soma.mp4.
- `CoachHero` beat 3: real kettlebell/Auckland-skyline photo (was placeholder).
- `CoachBio`: premium black-bg portrait + purple studio training shot (was 2 placeholders).
- `CoachVideos`: single featured real client video (replaced 4 empty boxes; only 1 video provided).
- `CoachTestimonials`: rewrote as editorial quote cards with the real LinkedIn recommendations (Karin Upton Baker/Hermes, Stephen Layfield, Benjamin Chong/Right Click Capital, Phil Sharp/Morgan Stanley, Jenny Macdonald) + a LinkedIn verification tag. Removed the empty screenshot placeholders.
- `page.tsx`: added a full-bleed cinematic powder-shot break between BetweenSessions and Process.

Design approach: read as premium/luxury-minimal personal brand → redesign-preserve (kept the black/white editorial identity, added real photography + restrained polish). Verified in browser (desktop + 390px mobile), no console errors, no overflow, build passes.

Still placeholder (no asset provided): `CoachBetweenSessions` app-screenshot slot (9/16). 

TODO / recommendation: `client-soma.mp4` is 31MB committed to git. For production, move it to Supabase Storage or Vercel Blob and reference by URL to avoid repo bloat. Extra brand photo `pedro-intense` (dramatic blue/red close-up) is available in the Drive design folder if another accent is wanted.


### Deploy drift + JSON resilience + pipeline-health skills (2026-05-28, LATEST)

After the wall-clock fix, a generation for Anna Long failed with "Movement analysis failed: Movement analysis did not return valid JSON". Root cause was NOT a new code bug - it was **deploy drift**: every pipeline agent's *deployed* build was older than its *committed local* source. The movement agent in production was the 2026-05-25 version that 502s on bad JSON; the JSON-repair + deterministic fallback added on 2026-05-27 (commit 5a5e117) was committed but never actually deployed (the handoff claimed it was). So a "fixed" bug was still live in production.

Fixes shipped:
- Redeployed ALL drifted pipeline agents so production == committed local: movement-analysis-agent, client-analysis-agent, exercise-intelligence-agent, methodology-plan-agent, programme-synthesis-agent, programme-validation-agent (orchestrator was already current).
- Hardened `methodology-plan-agent` (commit edfe4d3): it now falls back to a deterministic MethodologyPlan (built from the already-scaled Helms week blocks) on model error / unparseable JSON, instead of returning a hard 502. Matches the fallback pattern already in client-analysis / movement / exercise-intelligence.
- Verified: re-ran Anna Long twice (3-day and 4-day splits) - both reached `needs_review` end to end, all steps succeeded. Ruby also reached needs_review earlier. The reconcile broke nothing.

New skills (in ~/.claude/skills/, validated):
- `pt-pipeline-deploy-verify` (NEW): `scripts/drift_check.sh <cerebro-site-path> [check|fix]` compares each pipeline function's deployed `updated_at` (Supabase Management API) against its git commit time (UTC epoch, 15-min tolerance to avoid deploy-then-commit false positives), reports a drift table, and redeploys stale ones with `--use-api`. Run it after editing any agent and before claiming a fix is live. Confirmed: all 9 functions currently report in-sync.
- `pt-run-patcher` (EXTENDED into the "generation doctor"): added a Step 0 failure-classification table (deploy drift / bad JSON / wall-clock zombie / agent error -> remedy), refreshed the stale "Known causes" and "Pipeline step reference" sections to the current 3-stage self-chaining orchestrator. It now points to `pt-pipeline-deploy-verify` as the first check for the bad-JSON / inconsistent-failure class.

How the two skills work together: `pt-pipeline-deploy-verify` PREVENTS the drift class (keeps prod == committed source); `pt-run-patcher` DIAGNOSES a failed/stuck run and clears it. When a generation fails: classify with pt-run-patcher -> if drift suspected, run pt-pipeline-deploy-verify -> retry.

Note: edge function source files are NOT auto-deployed on git push. After editing any `supabase/functions/*` file, run `pt-pipeline-deploy-verify` (or `supabase functions deploy <slug> --use-api`) or the fix will not reach production.


### Programme generation timeout fixed: orchestrator self-chaining stages (2026-05-28, LATEST)

Pedro tried to generate a programme for Ruby Thomas and it failed with "Pipeline timed out. The server may still be running."

Root cause (confirmed via edge logs, not guessed): Supabase edge workers, including `EdgeRuntime.waitUntil` background tasks, are force-killed at a ~150s wall-clock limit. The orchestrator booted at 07:25:20 and was shut down at exactly 07:27:50 (150s), right after 1RM Test. Hypertrophy/strength/validation never ran, and the run zombied in `running` forever. The whole pipeline (4 sequential Claude agent calls ~146s + synthesis + validation) does not fit in one 150s worker. It only succeeded on prior days when Anthropic latency happened to be low.

Fix (`supabase/functions/pt-programme-orchestrator/index.ts`, deployed):
- Split `runPipeline` into 3 stages that each chain to the next via a self-invocation, so every stage gets a fresh ~150s budget:
  1. `analyze_client_movement`: client-analysis -> movement-analysis
  2. `exercise_methodology`: exercise-intelligence -> methodology-plan
  3. `synthesize`: per-phase synthesis -> cross-check -> validation -> finalize
- Inter-stage state stashed under `coaching_reasoning._scratch`, dropped cleanly at finalize.
- Resume/self-invoke calls require `CEREBRO_INTERNAL_SECRET` (orchestrator is verify_jwt=false). The wizard's initial call path is unchanged, so no client/wizard change needed.
- Per-agent `callAgent` timeouts tightened (75-80s) so a slow agent fails fast instead of letting a stage approach the wall-clock limit.
- IMPORTANT: every sub-agent call, input, and order is identical. The skill chain is unchanged. Only the orchestrator control flow is split.

Verification:
- Deployed via `supabase functions deploy pt-programme-orchestrator --use-api`.
- Smoke-tested on the exact failing client (Ruby Thomas, af85a4c8) by invoking the orchestrator directly (does NOT create a client-visible assignment). Run 1da4b557 reached `needs_review` at ~150s total across 3 fresh workers. All 11 steps succeeded including the previously-fatal HYPERTROPHY and STRENGTH. 5 phases, validation passed, 0 hard failures, `_scratch` dropped at finalize.
- Marked the original zombied run 5d06e78d as `failed` so it no longer lingers.

Note: Pedro can now regenerate Ruby's programme from the wizard normally. The smoke-test run 1da4b557 is a valid `needs_review` draft but is not wired to the wizard session (direct invocation), so it will not auto-open.


### Session credit deduction without booking (2026-05-28, LATEST)

Pedro tracked 3 PT sessions (Jenny, Joseph, Stephen) using Finish Session but sessions_remaining was not decremented because none of those clients had a linked booking appointment.

Root cause: `handleFinishSession` in `PTSessionsView.tsx` only deducted sessions via the `manage-pt-booking` 'complete' action, which requires a linked `pt_booking_appointments` row. When Pedro tracks sessions without the booking system, `selectedClientNextAppt` is null and the deduction was silently skipped.

Fix: Added an `else` branch in `handleFinishSession` that runs when there is no linked appointment:
- Decrements `sessions_remaining` on `pt_clients` directly
- Inserts a `pt_session_ledger` entry (`entry_type: 'session_completed'`, `quantity: -1`) so the ledger stays accurate
- Removed the "No linked appointment - session count unchanged" note from the UI (it was correct but now it's no longer true)

Files changed: `app/dashboard/pt/pt-sessions/PTSessionsView.tsx`
Commit: `b6a032b`
Build: passes clean.

Note: Pedro needs to manually fix the 3 sessions from today (Jenny, Joseph, Stephen). Decrement each client's `sessions_remaining` by 1 in Supabase or from the client card, since the system did not do it automatically at the time.


### Programme creator intelligence chain + publish gate (2026-05-27, LATEST)

Pedro asked to fix the PT programme creator because the intelligence skill was not firing and generated programmes were generic.

Changes shipped:
- `supabase/functions/pt-programme-orchestrator/index.ts`
  - Added explicit `EXERCISE_INTELLIGENCE` and `PROGRAMME_CROSS_CHECK` steps.
  - Movement analysis is now required; empty/no mind map fails the run instead of silently continuing generic.
  - Orchestrator now calls `exercise-intelligence-agent`, persists the exercise master list into `pt_client_exercise_doc.progression_strategy.exercise_intelligence`, creates missing `pt_exercises` cards with `video_url = null`, persists staples into `pt_programme_staples`, writes the movement mind map as a JSON object, and stores cross-check findings in `coaching_reasoning.programme_cross_check`.
  - Staples are deduped before upsert so duplicate phase/exercise rows do not crash the run.
- `supabase/functions/movement-analysis-agent/index.ts`
  - Stores `movement_assessment_summary` as an object, not `JSON.stringify(...)`.
  - Added deterministic fallback mind map if the model is unavailable.
- `supabase/functions/exercise-intelligence-agent/index.ts`
  - Generates 6 exercises per muscle.
  - Added robust JSON parsing plus deterministic fallback from the muscle mind map and exercise library.
  - Model wait is capped at 20s so Anthropic quota/slow calls do not break the orchestrator.
- `supabase/functions/client-analysis-agent/index.ts`
  - Added deterministic fallback if Anthropic is quota-limited.
- `app/dashboard/pt/programmes/new/PTProgrammeWizard.tsx`
  - Added progress labels for exercise intelligence and cross-check.
  - Supports prefill from client detail via `sessionStorage`.
  - New generated assignments are saved as `draft`, not visible to clients.
- `app/dashboard/pt/clients/[id]/PTClientDetail.tsx`
  - New programme action now opens the full programme creator instead of the old `pt-programming-agent` path.
  - Manual template assignment defaults to `draft`.
- `app/dashboard/pt/programmes/[id]/edit/PTProgrammeEditView.tsx`
  - Added explicit save vs publish actions.
  - Publishing pauses other active assignments for that client and marks the current assignment `active`.
- DB migrations:
  - `20260527090000_pt_programme_publish_gate.sql`: client RLS only allows active+approved programmes; adds `pt_programme_staples`.
  - `20260527093000_normalize_movement_summary_json.sql`: converts old JSON-string movement summaries to JSON objects.
  - `20260527094000_index_programme_staples_generation_run.sql`: indexes new staples FK.

Deployment / verification:
- Applied all migrations to Supabase project `otcnrkfvgyvwolironoz`.
- Deployed Edge Functions: `pt-programme-orchestrator`, `client-analysis-agent`, `movement-analysis-agent`, `exercise-intelligence-agent`.
- Production smoke run `7f43a916-459f-4045-a399-3b8d0e510ffa` completed with status `needs_review`.
- All 11 steps succeeded: client analysis, movement analysis, exercise intelligence, methodology, foundation, 1RM test, hypertrophy, strength, 1RM retest, cross-check, validation.
- Run saved 55 exercise intelligence entries, 44 staple records across 5 phase buckets, cross-check exists, missing exercises `[]`.
- `pt_client_exercise_doc.movement_assessment_summary` is now JSON object; `progression_strategy.exercise_intelligence` exists.
- `npx tsc --noEmit` passes.
- `npm run build` passes locally and on Vercel.
- Production deployed and aliased to `https://cerebroai.au` via Vercel deployment `dpl_3d8ZdqyTaTFL8N8JYKH9YFqMr1Xz`.

Notes:
- The final orchestration smoke was direct to the Edge Function, so it does not create a UI assignment. The wizard still creates the draft assignment when Pedro saves from the app.
- Supabase advisors after schema work still show pre-existing project-wide warnings (`pg_net` in public, leaked password protection disabled, older unindexed FKs/RLS perf issues). The new table's FK index warning was fixed.

### Muscle type tags on programme edit board view (2026-05-27, LATEST)

Pedro noticed the programme editing page (`/dashboard/pt/programmes/[id]/edit`) board view was missing the muscle type badges (lower sl / lower bi / upper bi / core) already present on the Step 3 board view in the new programme creation wizard.

Changes shipped:
- `app/dashboard/pt/programmes/[id]/edit/PTProgrammeEditView.tsx`
  - Added `getMuscleTag()` helper (exact copy from wizard) above the existing `draftReviewSummary` function.
  - Board view exercise cards now render the same coloured pill badges (green = lower, blue = upper, amber = core) next to the exercise name, inferred from exercise name + library muscles/tags.
  - No schema changes, no new props. The view already receives the `exercises: PTExercise[]` library array.

Verification:
- `npx tsc --noEmit`: no errors in PTProgrammeEditView.tsx.
- `npm run build`: passes clean.


### Programme builder board edit + current-workout PDF upload fix (2026-05-26, LATEST)

Pedro reported two issues in the programme builder:
- Step 3 board view exercise click flickered and did not stay open for swapping exercises.
- `+ Add current workout` could not upload PDFs.

Changes shipped:
- `app/dashboard/pt/programmes/new/PTProgrammeWizard.tsx`
  - Board-view exercise names now enter edit mode on `mouseDown` with drag propagation stopped, so native drag no longer steals the click.
  - Removed the blur timeout that closed the inline editor while Pedro was trying to type/select a replacement.
  - The inline exercise editor now closes on `Enter`, `Escape`, selecting an autocomplete result, or delete.
- `app/dashboard/pt/programmes/CurrentWorkoutImportModal.tsx`
  - File input now accepts `image/*,.pdf,application/pdf`.
  - Uploaded PDFs are parsed through the existing authenticated `/api/pt/parse-pdf` route.
  - Parsed PDF text is appended into the workout text box and then sent through the existing `import-current-workout` flow.
  - UI copy now says screenshots/PDFs.

Verification:
- `npm run build` passes.
- `npx eslint app/dashboard/pt/programmes/CurrentWorkoutImportModal.tsx` passes.
- `npx eslint app/dashboard/pt/programmes/new/PTProgrammeWizard.tsx app/dashboard/pt/programmes/CurrentWorkoutImportModal.tsx` still hits pre-existing warnings plus the existing `react-hooks/set-state-in-effect` error around draft hydration in `PTProgrammeWizard.tsx`.
- Playwright verified `/dashboard/pt/programmes/new` on `http://localhost:3001`:
  - test draft loaded into Step 3 board view
  - clicking `Goblet Squat` kept the inline exercise input open
  - typing in the input showed autocomplete
  - `+ Add current workout` modal file input advertises `image/*,.pdf,application/pdf`

### PT email editor drafts, personalization, drag/drop, and uploads (2026-05-26, LATEST)

Pedro wanted the PT Email builder to feel closer to Klaviyo:
- recipient names in headings/titles at scale
- wider editor cards aligned to the selected workflow card
- Add Block menu as a card below the workflow card, 3 options per row
- subject, preview, and content blocks using the same wide column
- drag/drop reordering
- image/GIF upload from the computer
- Save Draft and Make Live workflow states

Changes shipped:
- `app/dashboard/pt/emails/PTEmailsView.tsx`
  - Added personalization tokens for client name, client email, and setup link.
  - Default new-client heading now uses `{{ .Data.full_name }}` so the recipient sees their own name.
  - Preview renders sample token values, e.g. `Raquel`, so Pedro can see the personalised result while editing.
  - Builder layout is now wider with a single full-width editing column.
  - Personalisation and Add Block are full-width cards below the selected workflow card.
  - Add Block shows Heading, Text, Button, Photo/GIF, Divider, Spacer in a 2x3 grid on desktop.
  - Blocks can be reordered with drag handles via `@dnd-kit/core`.
  - Image blocks support local file upload for JPG, PNG, WebP, and GIF plus manual URL, alt text, and caption.
  - Added `Save draft` and `Make live` actions. `Make live` still validates that the invite email contains `{{ .ConfirmationURL }}` before updating Supabase Auth.
- `supabase/migrations/20260526015708_pt_email_templates_and_assets.sql`
  - Added `pt_email_templates` table for draft/live template state.
  - Added RLS policies restricted to Pedro/admin users.
  - Added public `pt-email-assets` storage bucket with 10MB image/GIF limit and admin write policies.
- `supabase/migrations/20260526020308_pt_email_template_fk_indexes.sql`
  - Added FK indexes for `updated_by` and `published_by`.

Deployment / database:
- `supabase db push` was blocked by existing remote migration drift unrelated to this feature.
- Applied both migrations with Supabase MCP `apply_migration`.
- Supabase performance advisor was re-run after adding FK indexes; no new `pt_email_templates` warnings remain.
- Security advisor still shows only pre-existing warnings: `pg_net` in public and leaked-password protection disabled.

Verification:
- `npx eslint app/dashboard/pt/emails/PTEmailsView.tsx app/dashboard/pt/emails/page.tsx` passes.
- `npm run build` passes.
- Playwright verified `/dashboard/pt/emails` on local `http://localhost:3001`:
  - no desktop horizontal overflow
  - no 390px mobile horizontal overflow
  - `Add name to heading` shows `Raquel` in preview
  - Photo/GIF block exposes upload and URL fields
  - Save draft returns `Draft saved.`
  - local PNG upload returns `Image uploaded.`

Notes:
- Current live publishing still only updates the Supabase Auth invite template for the new-client password setup email.
- Other visible workflows can be edited and drafted in `pt_email_templates`, but their senders still need to be wired to read from this template table before `Make live` can control them.
- A test draft and one test asset may exist in production from browser verification.

### pedroavila.coach coach landing page (2026-05-26, LATEST)

Built a full personal brand landing page at `/coach` inside the cerebro-site Next.js app.

**Route:** `cerebroai.au/coach` internally, routed from `pedroavila.coach` via host-based rewrite in `next.config.ts`.

**Sections (in order):**
- `CoachNav` - sticky transparent→white nav, "Book assessment - $10" CTA
- `CoachHero` - 3-beat scroll-reveal (300vh sticky container): beat 1 = intro text, beat 2 = big Fraunces headline, beat 3 = two-column final layout with photo placeholder + CTA
- `CoachProblem` - "What's actually going on" - full PDF copy, two-column FadeIn
- `CoachBio` - Pedro bio with 2 photo placeholders and full bio copy
- `CoachVideos` - 4 dark video thumbnail placeholders (2x2 grid)
- `CoachTestimonials` - horizontal scroll-snap carousel with 8 LinkedIn screenshot image placeholders + 5 quotes with text from PDF, prev/next arrows
- `CoachBetweenSessions` - "The system" section with app screenshot placeholder
- `CoachProcess` - 3-step numbered process, giant decorative numbers in Fraunces
- `CoachChat` - dark bg email capture CTA at `#start` anchor (chat placeholder for later)
- `CoachFooter` - Pedro Avila Coaching footer with location + Instagram

**To make pedroavila.coach live:**
1. In Squarespace DNS → delete the 4 A records pointing to Squarespace IPs
2. Add A record: Name=`@`, Data=`76.76.21.21` (Vercel)
3. Change CNAME `www` → `cname.vercel-dns.com` (was `ext-sq.squarespace.com`)
4. In Vercel dashboard → add `pedroavila.coach` as custom domain for the cerebro-site project

**What Pedro needs to upload later:**
- 8 LinkedIn screenshot images (replace placeholders in testimonials carousel)
- 4 client video files (replace placeholder cards in CoachVideos)
- 2+ photos of Pedro (replace placeholders in CoachBio + CoachHero beat 3)
- App screenshot (replace placeholder in CoachBetweenSessions)
- Wire up the AI chat (CoachChat section has the placeholder `#start` anchor and email form)

**Verification:** `npm run build` passes, `/coach` built as static page (○).

### PT email workflow editor + live invite template bridge (2026-05-26)

Pedro wanted to see all email workflows already in place, click an outgoing email workflow, edit the email, add photos/GIFs, and specifically design the first email new PT clients receive with the password setup/login link.

Changes shipped:
- `app/dashboard/pt/emails/PTEmailsView.tsx`
  - Reworked the Email page from a single composer into a workflow/template editor.
  - Left rail lists the detected live workflows:
    - New client password setup
    - Returning client login link
    - Password reset
    - Booking confirmation
    - Booking cancelled
    - Session-credit alert
    - Coach booking notice
    - Weekly PT summary
    - Lead chat welcome
    - Lead proposal email
  - The new-client password setup workflow is marked `Live`; the other currently code-owned workflows are visible/editable in the editor UI but not yet wired to persist live templates.
  - Added block-based email editing: eyebrow, heading, text, button, photo/GIF URL, divider, spacer.
  - Added professional HTML preview and generated email HTML copy.
  - Added validation so the live invite email keeps `{{ .ConfirmationURL }}` in the button/link.
- `app/dashboard/pt/emails/page.tsx`
  - Simplified server data load to recent notification log rows only.
- `supabase/functions/manage-email-template/index.ts`
  - New authenticated Edge Function for loading/saving the hosted Supabase Auth invite template through the Supabase Management API.
  - Uses Pedro/admin auth checks and `CEREBRO_SUPABASE_ACCESS_TOKEN` Edge secret.

Deployment:
- Set Edge Function secret `CEREBRO_SUPABASE_ACCESS_TOKEN` from local `.env.local`.
- Deployed `manage-email-template` to Supabase project `otcnrkfvgyvwolironoz`.

Verification:
- `npm run build` passes.
- `npx eslint app/dashboard/pt/emails/page.tsx app/dashboard/pt/emails/PTEmailsView.tsx supabase/functions/manage-email-template/index.ts` passes.
- Playwright verified `/dashboard/pt/emails` on `http://localhost:3001/dashboard/pt/emails`.
- The page successfully loads the live Supabase invite subject `Your Pedro Avila Coaching programme`.
- Adding a Photo/GIF block exposes URL, alt text, and caption fields.
- Mobile `390px` viewport has no horizontal overflow.

Notes:
- Supabase docs confirm hosted Auth templates can be updated with the Management API using `mailer_subjects_invite` and `mailer_templates_invite_content`.
- Next step for full Klaviyo-style workflow control is moving code-owned Resend emails (`manage-pt-booking`, `weekly-pt-summary`, `chat`, `generate-proposal`) to read templates from a shared template table/function instead of hardcoded text.

### Board view inline exercise edit + delete (2026-05-26, LATEST)

In step 3 of the new programme wizard, clicking an exercise name in board view now opens an inline editor:
- The exercise name becomes an editable input field (auto-focused).
- Typing 2+ characters shows a library autocomplete dropdown (same `exercise-autocomplete no-glass` pattern as PTDayEditor).
- Selecting from the dropdown updates `name`, `exercise_id`, `video_url`, and `cues`.
- A ✕ button deletes the exercise and repairs `section_start` markers on adjacent exercises.
- Dragging is disabled on the card while it is in edit mode.
- Blurring the input (with 150ms delay, same as PTDayEditor) closes editing without dropdown conflict.

Files changed:
- `app/dashboard/pt/programmes/new/PTProgrammeWizard.tsx`
  - Added `PTProgrammeExercise` to type imports.
  - Added `boardEditExId` state.
  - Added `getBoardMatches()`, `patchBoardExercise()`, `deleteBoardExercise()` helpers.
  - Board card rendering now branches on `isEditing` to show input+dropdown+delete or read-only name.

Verification:
- `npx tsc --noEmit` - no errors in PTProgrammeWizard.tsx (one pre-existing error in emails/page.tsx unrelated).
- `npm run build` passes.

### PT dashboard email creation page (2026-05-26)

Pedro wanted the existing PT dashboard Email menu item to open a real email creation page.

Changes shipped:
- `app/dashboard/pt/emails/page.tsx`
  - Replaced the placeholder with a server-loaded page that fetches active PT clients and recent PT notification log rows.
  - Normalizes Supabase joined `pt_clients` data before passing it to the client component.
- `app/dashboard/pt/emails/PTEmailsView.tsx`
  - Added a client-side composer for weekly reset, session follow-up, nutrition check, accountability, and custom emails.
  - Lets Pedro select a client, review client context, add specific notes, choose tone, edit subject/body, copy the email, or open a prefilled `mailto:` draft.
  - Shows recent automatic PT email sends from `pt_notification_log`.

Verification:
- `npm run build` passes.
- `npx eslint app/dashboard/pt/emails/page.tsx app/dashboard/pt/emails/PTEmailsView.tsx` passes.
- `npm run lint` still fails on existing unrelated repo-wide lint issues in older files such as `app/client/ClientPortal.tsx`, `app/client/MessageBubble.tsx`, `app/client/NutritionChatModal.tsx`, and several Supabase functions.
- Playwright verified `/dashboard/pt/emails` on the existing local dev server at `http://localhost:3001/dashboard/pt/emails`; desktop rendered with real client data and mobile `390px` viewport had no horizontal overflow.

Notes:
- Existing unrelated dirty file left untouched:
  - `app/dashboard/pt/programmes/new/PTProgrammeWizard.tsx`

### Foundation programme exercise selection guardrails (2026-05-25, LATEST)

Pedro found a generated Foundation day where every workout exercise was a pull-up variation. He clarified the Foundation model from screenshots:
- Pain and movement restrictions outrank performance goals.
- A pull-up goal gets one pull slot per day, not a day full of pull-up variations.
- The rule applies to all exercise families, not only pull-ups.
- Foundation days should be Day 1 unilateral, Day 2 bilateral, Day 3 unilateral.
- Generated Foundation days should only have `Warm Up` and `Workout`.

Changes shipped:
- Updated local skill source of truth:
  - `../skills/pt-programme-equipment-foundation-rules/SKILL.md`
  - `../skills/pt-programming-workflow/SKILL.md`
  - `../skills/pt-programme-builder/SKILL.md`
  - `../skills/pt-programme-intelligence/SKILL.md`
- `supabase/functions/pt-programme-orchestrator/index.ts`
  - Passes `muscle_mind_map` into `programme-synthesis-agent`.
- `supabase/functions/programme-synthesis-agent/index.ts`
  - Foundation now uses the full exercise library plus safety filters, not the trimmed synthesis slice.
  - Foundation uses a slot selector: pull, push, anterior lower, posterior lower, hip/core corrective.
  - Foundation caps same-day root-family duplicates.
  - Foundation no longer appends `MetCon` or `Stretches`.
  - Warm-up/corrective fallbacks reject strength-compound pull-up/press/deadlift rows.
- `supabase/functions/programme-validation-agent/index.ts`
  - Foundation hard-fails unexpected sections, repeated exercise families, or missing required slots.
- `supabase/functions/pt-programming-agent/index.ts` and `programming-principles.md`
  - Legacy/manual path rule text now matches the skill-owned Foundation model.

Deployed:
- `programme-synthesis-agent`
- `programme-validation-agent`
- `pt-programme-orchestrator`
- `pt-programming-agent`

Verification:
- `npm run build` passes.
- Live smoke run `69dd8369-1796-483b-96a1-5a065ecfa7b9` completed `needs_review` with `passed: true`, no findings, no hard failures.
- Smoke Foundation output had only `Warm Up` and `Workout`, one pull slot per day, and no same-day pull-up variation stack.

Notes:
- A prior smoke against client `4f8e...` was invalidated because that client was deleted during the run and the draft row disappeared by cascade. Final verification used active client Thaisa.

### Workout journey rail tightened (2026-05-25, LATEST)

Pedro wanted the workout screen's "Your Journey" dropdown to keep Phase 2 / Phase 3 week checkpoints inside the container and read as a vertical milestone spine with small circles on the line.

Changes shipped:
- `app/client/ClientPortal.tsx`
  - The journey week rail now renders as a vertical spine with small circle checkpoints instead of the crowded card stack.
  - Week labels now render as `Week 1`, `Week 2`, etc, with the weekly set count shown in parentheses when available.
  - Percentage targets now render beside the set count in their own parentheses, matching the prior phase styling.
  - The 1RM test and retest steps now render as `1RM Testing Day` and `1RM Retest Day`.
  - The spine runs behind the circles so the green fill can light up each milestone as it is reached.
  - The rail now falls back to the phase week count when explicit week blocks are missing, so the layout still renders consistently.
  - The week text row was nudged to visually center against the milestone circles.
  - The layout was verified in both desktop and narrow mobile viewports.

Verification:
- `npm run build` passes.
- Playwright checks confirmed the week labels stay inside the container on a 390px-wide viewport and the circles remain vertically spaced.

Notes:
- Existing unrelated dirty changes remain in the broader repo, but this work only touched `app/client/ClientPortal.tsx` and the session docs.

### Security remediation pass (2026-05-25, Claude) - full tracker in `../SECURITY-AUDIT.md`
Worked through the security audit. Everything below is committed + pushed and verified live (anonymous calls return 401; Supabase advisor lints cleared).
- **DB RPCs:** revoked anon/authenticated/**PUBLIC** EXECUTE on `match_client_brain_chunks` (was letting anyone with the public anon key dump any client's private brain) and `delete_stale_program_drafts`. Migrations `20260525045450` + `20260525045511`. The default PUBLIC grant was the real hole; revoking just anon/authenticated wasn't enough.
- **Edge-function auth (HIGH-1 complete):** gates added so anonymous callers 401. `explain-journey-phase` (caller must own the `client_id`), `ingest-knowledge-document` + `query-knowledge-brain` (admin/PEDRO_EMAILS), `compute-client-metrics` + `embed-client-brain` + `seed-exercise-library` (service-role bearer; callers already send it). Pipeline agents were locked in a prior commit; `supabase/config.toml` pins `verify_jwt=false` so deploys can't silently re-lock them.
- **App:** `app/api/pt/parse-pdf/route.ts` now requires an authenticated session + caps size (15MB) / pages (60); `next.config.ts` adds HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy.
- **Then completed the rest the same day:**
  - HIGH-2: public chat bot now has per-IP rate limiting (`check_chat_rate_limit`, service-role only), message caps, capture min-turns. Verified.
  - HIGH-4: `post-to-x` cron fixed with a dedicated `CEREBRO_CRON_SECRET` in Supabase Vault; post-to-x set `verify_jwt=false` to accept the raw-secret bearer; cron re-pointed at Vault. Verified. No scheduled-post backlog existed.
  - MED-5 (ingest untrusted-data delimiters), LOW-2 (dropped bucket listing policy), LOW-5 (escaped lead email HTML).
- **Verified NON-issues:** `/finance` + `/operators` are public marketing pages (not admin); several functions were already gated.
- **Accepted / blocked (not live vulns):** HIGH-3 (email-open pixel HMAC; pixel URL not generated in code + random UUIDs), LOW-1 (HIBP needs Pro plan), LOW-3 (`pg_net` in public; moving it risks the cron).
- **Commits:** `e06deea`, `86d2599`, `cd30c65`, `b871dbd`, `8b048fa`, `47128f2`.
- **Did NOT touch** the in-progress `app/client/ClientPortal.tsx` change; left for its owner.

### Henrique chat header clarified (2026-05-25, LATEST)

Pedro wanted the chat header to show that Henrique is the personalised AI Coach, not just a name.

Changes shipped:
- `app/client/MessageBubble.tsx`
  - The top of the chat now shows `Henrique` with a second line: `Your personalised AI Coach`.
- `app/client/ClientPortal.tsx`
  - The intro copy on the overview screen now says `Henrique, your personalised AI Coach`.

Verification:
- `npm run build` passes.

Notes:
- Existing unrelated dirty changes are still present and were not staged by this task:
  - `app/api/pt/parse-pdf/route.ts`
  - `next.config.ts`
  - `supabase/functions/compute-client-metrics/index.ts`
  - `supabase/functions/embed-client-brain/index.ts`
  - `supabase/functions/explain-journey-phase/index.ts`
  - `supabase/functions/ingest-knowledge-document/index.ts`
  - `supabase/functions/query-knowledge-brain/index.ts`
  - `supabase/functions/seed-exercise-library/index.ts`
  - `supabase/migrations/20260525045450_revoke_public_execute_on_security_definer_rpcs.sql`
  - `supabase/migrations/20260525045511_revoke_public_role_execute_on_security_definer_rpcs.sql`

### Overview booking + weekly check-in cards (2026-05-25, LATEST)

Pedro wanted the client overview to behave consistently across booking and check-in workflows.

Changes shipped:
- `app/client/ClientPortal.tsx`
  - Next-session card now opens the Booking screen when clicked.
  - The stale `Use Tools to book` text was replaced with `Booking`.
  - Due-today now shows up to three clickable items that mark themselves done from the overview.
  - A weekly check-in card now appears above due-today when the check-in is due, with colour states that intensify as the check-in gets later.
- `supabase/functions/draft-weekly-plan/index.ts`
  - Weekly plan drafts now explicitly request a Friday `check_in` item titled `Weekly check-in`.
  - If the model omits it, the function appends a fallback `check_in` item so the overview always has a generated anchor item for the card.

Deployed:
- `draft-weekly-plan` redeployed on Supabase project `otcnrkfvgyvwolironoz`.

Verification:
- `npm run build` passes.

Notes:
- Existing unrelated dirty changes are still present and were not staged by this task:
  - `app/api/pt/parse-pdf/route.ts`
  - `next.config.ts`
  - `supabase/functions/compute-client-metrics/index.ts`
  - `supabase/functions/embed-client-brain/index.ts`
  - `supabase/functions/explain-journey-phase/index.ts`
  - `supabase/functions/ingest-knowledge-document/index.ts`
  - `supabase/functions/query-knowledge-brain/index.ts`
  - `supabase/functions/seed-exercise-library/index.ts`
  - `supabase/migrations/20260525045450_revoke_public_execute_on_security_definer_rpcs.sql`
  - `supabase/migrations/20260525045511_revoke_public_role_execute_on_security_definer_rpcs.sql`

### Client dashboard title updated (2026-05-25, LATEST)

Pedro wanted the client-facing dashboard title at the top left to say `Pedro Avila Coaching App` and to remove the old `Training` label.

Changes shipped:
- `app/client/ClientPortal.tsx`
  - Top-left brand text now says `Pedro Avila Coaching App`.
  - The `Training` heading directly under it was removed.

Verification:
- `npm run build` passes.

Notes:
- Existing unrelated dirty changes are still present and were not staged by this task:
  - `supabase/functions/compute-client-metrics/index.ts`
  - `supabase/functions/embed-client-brain/index.ts`
  - `supabase/functions/explain-journey-phase/index.ts`
  - `supabase/functions/ingest-knowledge-document/index.ts`
  - `supabase/functions/query-knowledge-brain/index.ts`
  - `supabase/functions/seed-exercise-library/index.ts`
  - `supabase/migrations/20260525045450_revoke_public_execute_on_security_definer_rpcs.sql`
  - `supabase/migrations/20260525045511_revoke_public_role_execute_on_security_definer_rpcs.sql`

### Client chat AI renamed to Henrique (2026-05-25, LATEST)

Pedro wanted the client-facing AI chat to be named Henrique because his full first name is Pedro Henrique, so Henrique represents the second version of Pedro inside the app.

Changes shipped:
- `app/client/MessageBubble.tsx`
  - Chat header now says `Henrique` instead of `AI Coach`.
  - AI message labels and the typing/thinking label now say `Henrique`.
  - Input placeholder now says `Message Henrique...`.
  - Handoff helper text now says `Say "hey Pedro" to reach Pedro directly`.
- `app/client/ClientPortal.tsx`
  - Nutrition onboarding intro now tells clients to message Henrique for questions and say `Hey Pedro` when they want Pedro directly.
- `supabase/functions/ai-client-chat/index.ts`
  - System prompt now identifies the assistant as Henrique.
  - If a client asks why the name is Henrique, the assistant explains that Pedro's full first name is Pedro Henrique, Henrique is his second first name, and the name fits because the assistant is the second version of Pedro inside the app.
  - The assistant is explicitly told not to pretend to be Pedro himself.

Deployed:
- `ai-client-chat` redeployed on Supabase project `otcnrkfvgyvwolironoz`.

Verification:
- `npm run build` passes.

Notes:
- Existing unrelated dirty changes are still present and were not staged by this task:
  - `supabase/functions/compute-client-metrics/index.ts`
  - `supabase/functions/embed-client-brain/index.ts`
  - `supabase/functions/explain-journey-phase/index.ts`
  - `supabase/functions/ingest-knowledge-document/index.ts`
  - `supabase/functions/query-knowledge-brain/index.ts`
  - `supabase/functions/seed-exercise-library/index.ts`
  - `supabase/migrations/20260525045450_revoke_public_execute_on_security_definer_rpcs.sql`
  - `supabase/migrations/20260525045511_revoke_public_role_execute_on_security_definer_rpcs.sql`

### Skill validator dependency fixed (2026-05-25, LATEST)

Pedro asked to fix the remaining validator issue after the Foundation equipment guardrail work.

Fix:
- Installed `PyYAML` into the local Python 3.14 user site packages.
- Re-ran the official skill creator validator:
  - `python3 /Users/pedroavila/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/pt-programme-equipment-foundation-rules`
  - Result: `Skill is valid!`

This means future skill validation can run locally without the previous `ModuleNotFoundError: No module named 'yaml'` blocker.

### Programme generation Foundation equipment guardrails (2026-05-25, LATEST)

Pedro wanted new PT programme-generation rules:
- If documents/Step 1 text explicitly say bands/bodyweight/home/no-gym only, programme for that.
- If equipment is not stated, default to gym.
- For gym Foundation, do not use banded exercises, especially not banded deadlifts.
- For gym Foundation hinges, prefer DB/KB/cable/machine options like DB deadlift, KB deadlift, single-leg DB RDL.
- Foundation should use tempo notes on every exercise.
- Foundation 3-day structure should be 2 single-arm/single-leg emphasis days and 1 bilateral emphasis day.
- Add Pedro's new Foundation staples and make the AI compare generated programming against client needs before returning the draft.

Changes shipped:
- New local skill: `skills/pt-programme-equipment-foundation-rules/SKILL.md`.
- Root `AGENTS.md` now includes this skill in the PT programme generation chain.
- Updated local PT programming skills:
  - `pt-programming-workflow`
  - `pt-programme-builder`
  - `pt-programme-intelligence`
- Active wizard path updated in `programme-synthesis-agent`:
  - deterministic Foundation generation filters out banded exercises when gym access is inferred,
  - Foundation Day 1/2 become unilateral emphasis,
  - Foundation Day 3 becomes bilateral emphasis,
  - every Foundation exercise gets tempo/control notes,
  - preferred staple patterns are picked first where present in the library.
- Legacy/manual path updated in `pt-programming-agent`:
  - prompt principles include the same rules,
  - added a final AI rule-review pass before validation,
  - validation now hard-fails gym Foundation drafts containing banded exercises or missing Foundation tempo/control notes.
- Exercise library:
  - Verified all 18 requested staples now exist in `pt_exercises`.
  - Added 11 missing exercise cards with `video_url = null` so Pedro can attach videos.
  - Added migration `20260525013700_seed_foundation_staples.sql` so the seed is tracked.

Deployed:
- `programme-synthesis-agent` ACTIVE v13.
- `pt-programming-agent` ACTIVE v13.

Verification:
- `npm run build` passes.
- Supabase function list confirms both functions active.
- Skill validator now passes after installing local `PyYAML`.

### Current workout import cleanup verification (2026-05-25, LATEST)

Pedro asked to double-check the new current-workout import feature and remove anything not connected to the build.

Checked:
- `CurrentWorkoutImportModal` is imported and used by both the new programme wizard and existing programme edit view.
- `appendDaysToFoundationPhase()` is imported and used by both programme screens.
- The modal calls the deployed `import-current-workout` Edge Function.
- The current-workout skill chain is referenced from root `AGENTS.md`.
- Skill folders only contain valid `SKILL.md` plus `agents/openai.yaml` metadata; no placeholder/TODO files were found.

Cleanup:
- Removed ignored stale local folder `.claude/` from `cerebro-site`; it was not part of the product build and was making lint scan old worktree files.
- Fixed the only lint issue in the current feature/touched helper: `normalizeWordNumbers()` now uses `const` where no reassignment occurs.

Verification:
- `npm run build` passes after cleanup.
- `npm run lint` still fails because of pre-existing repo-wide lint debt in unrelated files (`app/client/*`, old Supabase functions, `public/pdf.worker.min.mjs`). No current-workout feature lint error remains.

### Nutrition calculation overhaul v6: AI document reader + correct methodology (2026-05-25, LATEST)

Pedro flagged that John's nutrition (78kg, 54yo male, 171cm) was producing 2,975 kcal and 446g carbs.
Two root causes: the goal was being inferred from the PT programme type (strength → +3%), and
activity level 4 mapped to the wrong PAL.

Changes shipped:

1. **AI profile reader** (`generate-nutrition-programme` v6): new `inferClientProfile()` function makes
   a small Haiku (claude-haiku-4-5-20251001, max_tokens 400) call to read the client's documents
   (nutrition doc, exercise doc, lifestyle doc, pt_client_documents) and classify the real body-composition
   goal before calculating anything. Falls back to `maintain/none` on failure.

2. **6-level activity system** (replacing vague 1-5 numeric): PAL multipliers now match the standard
   Mifflin-St Jeor table exactly:
   - Level 1 Sedentary: 1.2 / Level 2 Light: 1.375 / Level 3 Moderate: 1.55
   - Level 4 Active: 1.725 / Level 5 Very Active: 1.9 / Level 6 Extra Active: 2.2

3. **Goal-based calorie multipliers** (7 categories, driven by client documents NOT PT programme):
   - maintain: ×1.0 / weight_loss mild: ×0.9 / moderate: ×0.8 / extreme: ×0.6
   - weight_gain mild: ×1.1 / moderate: ×1.2 / extreme: ×1.4

4. **Full reasoning chain** (9 steps logged per client): every nutrition plan now stores `reasoning_steps`
   as a jsonb array in `pt_client_nutrition_doc` so Pedro can audit the entire calculation:
   BMR → TDEE → goal multiplier → macros → phase adjustments → pyramid review.

5. **6-level activity selector UI** (`ClientPortal.tsx`): replaced 5 numeric tiles with 6 descriptive
   buttons in a 2-col/3-col grid, each showing label + short description.

6. **DB migration** applied: `activity_level` constraint now allows 1-6, `activity_tag` constraint
   includes `extra_active`, `reasoning_steps jsonb` column added to `pt_client_nutrition_doc`.

7. **Skills updated**: new `pt-nutrition-client-profile-reader/SKILL.md`, updated
   `pt-nutrition-target-calculator/SKILL.md`, updated `pt-nutrition-orchestrator/SKILL.md`.

8. **Types updated** (`utils/pt/types.ts`): `PTClient.activity_tag` union includes `active`, `extra_active`.

Edge function version: v6 ACTIVE.

Next: re-run John's nutrition to verify correct numbers (goal read from documents, carbs lower).

### Current workout import into Foundation (2026-05-25)

Pedro wanted a new button beside the recently added board/list view button so he can paste text or upload screenshots of a client's current programme and append those workouts into Phase 1 Foundation, without changing the AI-generated programme.

Changes shipped:
- New shared modal: `app/dashboard/pt/programmes/CurrentWorkoutImportModal.tsx`.
  - Accepts pasted workout text and up to 3 screenshots.
  - Preview calls `import-current-workout` in `preview` mode.
  - Confirm calls `commit` mode, then returns structured days to the parent UI.
- New Edge Function: `supabase/functions/import-current-workout/index.ts`.
  - Uses Anthropic vision/text to extract workout days from text/images.
  - Matches parsed exercises to `pt_exercises`.
  - In preview mode, returns missing exercise names without writing rows.
  - In commit mode, creates missing exercise cards with `source = ai` and `video_url = null`.
  - Deployed as active function v1 on Supabase project `otcnrkfvgyvwolironoz`.
- New programme wizard step 3:
  - `+ Add current workout` button appears next to Board/List view.
  - Confirmed imports append to Foundation, switch to board view, and show status.
- Existing programme edit view:
  - Same `+ Add current workout` button in the Workouts toolbar.
  - Imported days append to Foundation and require normal `Save changes` to persist.
- Shared helper in `utils/pt/programme.ts`:
  - `findFoundationPhaseIndex()`
  - `appendDaysToFoundationPhase()`
  - Finds Foundation by title, fallback phase 0, generates fresh IDs, prefixes imported days as `Current Programme - ...`.
- New local skill chain added outside `cerebro-site`:
  - `skills/pt-current-workout-import-orchestrator`
  - `skills/pt-current-workout-extract-source`
  - `skills/pt-current-workout-structure-days`
  - `skills/pt-current-workout-resolve-exercises`
  - `skills/pt-current-workout-append-foundation`
  - Root `AGENTS.md` updated with the chain and additive-only hard rule.

Verification:
- `npm run build` passes.
- `supabase functions deploy import-current-workout` succeeded.
- `supabase functions list` shows `import-current-workout` ACTIVE v1.
- Browser smoke test on `http://localhost:3001/dashboard/pt/programmes/new?draftKey=codex-import-smoke`:
  - loaded a draft programme,
  - opened step 3,
  - confirmed `+ Add current workout` beside Board view,
  - pasted a current workout,
  - Preview returned 1 day, 3 matched exercises, 0 new exercise cards,
  - Add to Foundation appended `Current Programme - Day 1` after generated Foundation days and switched to board view.

Notes:
- The official skill validator could not run because local Python is missing `PyYAML` (`ModuleNotFoundError: No module named 'yaml'`). Skill frontmatter was still kept minimal and manually checked.
- Existing unrelated local changes were present and not touched/staged by this task:
  - `utils/pt/types.ts` activity_tag union change.
  - `supabase/migrations/20260525000000_add_activity_level_6_extra_active.sql`.

### New programme wizard step 3 board view (2026-05-25, LATEST)

Pedro wanted the multi-workout programme board available while creating a client's programme, not just after the programme already exists. Step 3 of `/dashboard/pt/programmes/new` now has the same Trello-style phase workout board as the assignment edit page.

Changes shipped:
- `PTProgrammeWizard.tsx`: added `Board view` / `List view` toggle in step 3 for the active phase.
- Board view renders every workout day in the selected phase side by side, with compact exercise cards showing exercise name, sets, reps, and rest.
- Exercises can be dragged from one day to another, or dropped before another exercise to reorder.
- The wizard expands to `max-w-7xl` in board mode so 3-6 day phases have more usable width.
- `utils/pt/programme.ts`: added shared `moveExerciseBetweenProgrammeDays()` helper that preserves section context and re-stamps `section_start` markers after moves.
- `PTProgrammeEditView.tsx`: now uses the same shared helper instead of carrying duplicate board-move logic.

Verification:
- `npm run build` passes.
- Local smoke test on existing dev server `http://localhost:3001/dashboard/pt/programmes/new?draftKey=codex-board-smoke`:
  - loaded a sessionStorage draft into the wizard,
  - opened step 3,
  - toggled `Board view`,
  - confirmed Day 1, Day 2, Day 3 rendered side by side with exercise names,
  - dragged Back Squat from Day 1 to Day 3 and confirmed the DOM updated.

Notes:
- No DB schema changes. This is global because it edits the programme JSON in the shared new-programme wizard used for any selected client, and the existing assignment edit board still works through the same helper.

### Nutrition calculation overhaul + UX fixes (2026-05-25, LATEST)

Pedro flagged the nutrition calculation was completely off. Rebuilt the entire edge function with Pedro's exact methodology and added UX improvements.

Changes shipped:

1. **X close button on nutrition onboarding popup** (`ClientPortal.tsx`): clients can now dismiss the popup and access their training directly. Dismiss is session-only - the popup reappears on next login so they are encouraged to complete it. Button is positioned absolute top-right inside the onboarding panel.

2. **Real error message parsing** (`ClientPortal.tsx`): Supabase `functions.invoke()` returns a generic "Edge Function returned a non-2xx status code" string in `error.message`. Fixed by parsing `error.context` (a Response object) and extracting the actual JSON body from the edge function so Pedro and clients see the real error.

3. **No-programme path** (`generate-nutrition-programme` v4): clients without an active programme now complete onboarding successfully. The function saves biometrics, computes basic daily targets, upserts the nutrition doc with `daily_targets`, `protein_range_g`, and `goals_header`, and returns `ok: true`. Previously it returned 400 and the client was blocked.

4. **Full calculation overhaul** (`generate-nutrition-programme` v5): replaced the old ad-hoc formula with Pedro's exact methodology:
   - BMR: Mifflin-St Jeor if age + gender available, else `22 x weight_kg`
   - TDEE: BMR x activity multiplier (1.2/1.375/1.55/1.725/1.9 for levels 1-5)
   - Calories: TDEE x 0.85 (fat loss) / 1.07 (gain) / 1.03 (strength) / 1.0 (recomp)
   - Protein: always 1.5-2g/kg range. Target = 2.0g/kg fat loss, 1.8g/kg everything else. Never changes based on goal.
   - Fat: 0.9g/kg, clamped 50-120g
   - Carbs: remaining calories / 4, hard floor 100g always
   - Fibre: max(25, calories/1000 x 14), ceiling 70g
   - Phase adjustments: hypertrophy +120 kcal/+30g carbs, strength/testing +80/+20, deload -80/-20. 100g carb floor applies to phases too.

5. **Protein range stored as `{ min, max }` jsonb** (`pt_client_nutrition_doc.protein_range_g`): the range is now always stored separately from the single daily target so it can be displayed as "117g - 156g" to clients.

6. **Goals header stored as plain text** (`pt_client_nutrition_doc.goals_header`): a formatted block shown at the top of the client nutrition doc:
   ```
   NUTRITION GOALS - 25 May 2026
   Goal: Fat Loss  |  Activity: Very Active
   ----------------------------------------
   Calories:  1,950 kcal
   Protein:   117g - 156g  (1.5-2g per kg body weight)
   Carbs:     145g
   Fat:       70g
   Fibre:     27g
   ----------------------------------------
   ```

7. **Anthropic system prompt hard rules**: the Claude finalizer is now explicitly told protein must stay within 1.5-2g/kg, carbs never below 100g, fat never below 50g, and protein does not shift based on goal.

8. **Three skill files updated** (outside cerebro-site, not in git here):
   - `skills/pt-nutrition-target-calculator/SKILL.md` - complete rewrite with Pedro's exact 7-step formula
   - `skills/pt-nutrition-pyramid-finalizer/SKILL.md` - added HARD CONSTRAINTS section, updated failure behaviour to fall back instead of blocking
   - `skills/pt-nutrition-orchestrator/SKILL.md` - added goals header format, `protein_range_g` and `goals_header` to write sequence, no-programme path documentation

DB migration applied earlier in this session:
```sql
ALTER TABLE pt_client_nutrition_doc
  ADD COLUMN IF NOT EXISTS protein_range_g jsonb,
  ADD COLUMN IF NOT EXISTS goals_header text;
```

Edge function versions deployed this session:
- v3: AI fallback (try/catch around Anthropic calls, `draftAsFinalPlan` helper)
- v4: No-programme path (return 200 with basic targets when no active programme)
- v5: Full calculation overhaul (Pedro's exact formula, protein range, goals header, carb floor, Anthropic HARD RULES)



### Nutrition onboarding + Pyramid finalizer (2026-05-22, LATEST)

Pedro wanted the nutrition side to start when the client first logs in because client weight/height/activity were missing from uploaded docs. Built the first-login nutrition onboarding gate and the finalization workflow around `Cerebro Knowledge/The Muscle and Strength Pyramid - Nutrition v2.0 .pdf.pdf`.

Why this was done:
- Uploaded assessments/documents often include goals, injuries, training context, and habits, but not reliable bodyweight/height/activity. Nutrition targets cannot be responsibly calculated without those inputs.
- Pedro chose auto-publish for nutrition, so the system needed a stronger evidence gate: first deterministic draft, then Helms Nutrition Pyramid finalizer, then publish.
- Nutrition decisions must become part of the client brain, not a separate one-off widget state. The client card, nutrition dashboard, phase nutrition, and weekly reports now all point back to the same stored profile and targets.

Changes shipped:
- Added local skills and AGENTS chain: `pt-nutrition-onboarding`, `pt-nutrition-orchestrator`, `pt-nutrition-target-calculator`, `pt-nutrition-pyramid-finalizer`, `pt-nutrition-phase-builder`, and `pt-weekly-client-brain-review`.
- DB migration applied remotely and committed locally: `pt_clients` now stores height/current weight/activity level/activity tag/nutrition onboarding timestamp; `pt_client_nutrition_doc` stores `pyramid_finalizer`; `pt_phase_nutrition` stores `finalizer_notes`; new `pt_client_brain_reports` table stores weekly client brain reports; cron job `weekly-client-brain-review` runs Sundays 20:00 UTC.
- New Edge Function `generate-nutrition-programme` deployed v1, then redeployed v2 with service-role support. It validates client/admin/service access, stores onboarding data, inserts a weight metric, builds deterministic draft targets, retrieves Nutrition Pyramid context via `retrieve-knowledge-context`, runs a Claude finalizer, then auto-publishes `daily_targets`, approved `pt_phase_nutrition`, `nutrition_sync`, and brain updates.
- New Edge Function `weekly-client-brain-review` deployed v1. It reads weekly workouts, set logs, nutrition logs, check-ins, messages, metrics, active programme, nutrition doc, and approved phase nutrition, then upserts a durable `pt_client_brain_reports` row and updates the brain docs.
- Client portal now shows a welcome/onboarding screen only when nutrition onboarding is incomplete. It asks height, weight, activity level 1-5 and tells the client to use the black message box top-right and say "Hey coach" to reach Pedro.
- Nutrition tab now shows approved programme phase nutrition. Pedro's client card now shows body profile, activity tag, daily targets, current phase nutrition, and latest weekly brain report.

Verification:
- `npm run build` passes.
- Remote migration applied successfully through Supabase MCP.
- `supabase functions list` shows `generate-nutrition-programme` and `weekly-client-brain-review` active.
- Remote schema checks confirmed new columns/table/cron.
- Weekly brain report runtime smoke test succeeded for Thaisa (`client_id` 7e0023d9), creating report `0f97a2ee`.
- `deno check` could not run locally because `deno` is not installed.
- `generate-nutrition-programme` was not smoke-tested against a real client to avoid publishing real nutrition targets without Pedro choosing a client.

Advisor notes:
- Supabase security/performance advisors still show existing project warnings (pg_net in public, old SECURITY DEFINER grants, old unindexed FKs/duplicate indexes). No new nutrition-table-specific advisor issue was identified in the output.

How it runs now:
- Client opens `/client`.
- `ClientPortal.tsx` loads their `pt_clients` row.
- If height/current weight/activity/onboarding timestamp are missing, the normal app is replaced with the nutrition welcome screen.
- Client enters height, weight, activity level 1-5, then clicks "Create my nutrition programme".
- Browser invokes `generate-nutrition-programme`.
- Function stores profile data, inserts a `pt_client_metrics` weight record, builds deterministic draft targets, retrieves Helms Nutrition Pyramid context through `retrieve-knowledge-context`, asks Claude to finalize the plan, then writes:
  - `pt_client_nutrition_doc.daily_targets`
  - `pt_client_nutrition_doc.phase_nutrition_strategy`
  - `pt_client_nutrition_doc.pyramid_finalizer`
  - approved `pt_phase_nutrition` rows for every active programme phase
  - `pt_program_assignments.nutrition_sync`
  - structured client brain updates via `update-client-brain`
  - refreshed embeddings via `embed-client-brain`
- The client nutrition dashboard reads `daily_targets` and approved `pt_phase_nutrition`.
- Pedro's client card reads the same nutrition doc, phase nutrition rows, body profile fields, and latest `pt_client_brain_reports`.
- Weekly cron calls `weekly-client-brain-review`, which creates/upserts one report per client/week.

Important implementation details:
- The Helms PDF is not parsed directly in the nutrition function. The function uses the existing knowledge/RAG layer, and `retrieve-knowledge-context` already prioritizes "Eric Helms Nutrition Pyramid" by title patterns (`muscle and strength pyramid`, `nutrition v2`, `helms nutrition`). This avoids repeatedly loading/parsing a large PDF.
- `generate-nutrition-programme` is deployed `--no-verify-jwt` but performs its own auth. It allows the logged-in client for their own row, Pedro/admin, or service-role internal calls.
- `weekly-client-brain-review` is also deployed `--no-verify-jwt` and allows Pedro/admin, service role, or the cron token `cerebro-cron-2026`.
- The generator was intentionally not smoke-tested against a real client because it auto-publishes real targets and would mutate production client nutrition.

Future TODOs:
- Run the full first-login nutrition flow in Pedro's logged-in browser with a chosen client and confirm the screen hides after completion.
- Add a coach-facing "Regenerate nutrition" button on the client card for cases where Pedro updates weight/activity/goals later.
- Add a "Reset nutrition onboarding" admin action for incorrect client input.
- Add a manual review/audit panel showing Pyramid principles applied, changes from draft, and Claude finalizer notes.
- Decide whether the weekly brain report should email Pedro, surface as an open coaching task, or only live on the client card.
- Consider moving the cron auth token from hardcoded fallback to a Supabase secret before this becomes sensitive.
- Add test fixtures or a non-production client for `generate-nutrition-programme` so future agents can smoke-test without mutating a real client.

Token-efficiency notes for future agents:
- Do not reread the whole Nutrition Pyramid PDF unless changing the retrieval/finalizer logic. Use `retrieve-knowledge-context` for targeted excerpts.
- Do not run broad `rg nutrition` across the whole repo unless needed; start with `ClientPortal.tsx`, `NutritionTab.tsx`, `PTClientDetail.tsx`, `generate-nutrition-programme`, `weekly-client-brain-review`, and `utils/pt/types.ts`.
- For Supabase verification, prefer focused SQL checks on the exact new columns/tables/jobs and `supabase functions list`. Advisor output is large and mostly contains old unrelated warnings.
- Do not smoke-test auto-publish flows on real clients unless Pedro names the client. Use build, deployment, schema checks, and non-mutating weekly report tests instead.

### Trello-style board view for phase workouts (2026-05-22, LATEST)

Pedro wanted, on the programme editor Workouts section, a button to see ALL days of a phase side by side (like Trello) and drag-drop exercises between days. 3 days = 3 columns, 6 days = 6 columns, all visible at once.

All in PTProgrammeEditView.tsx:
- "Board view" / "List view" toggle button in the Workouts header (shows only when the active phase has days).
- Board renders a CSS grid with `gridTemplateColumns: repeat(n, minmax(0,1fr))` where n = phase.days.length, so every day fits side by side regardless of count. Each column is a day with its exercises as compact draggable cards, grouped by section_start header.
- Cross-day drag-drop: each exercise card is draggable (native HTML5 DnD, matching the rest of the app); a day column is a drop target (append) and each card is a drop target (insert before). Dropping moves the exercise between days or reorders within a day.
- section_start only marks the FIRST exercise of a section, so moves go through resolveDayExercises() (flatten to {ex, section} by walking section_start) -> splice -> buildDayExercises() (stable sort by canonical Warm Up/Workout/MetCon/Stretches order, re-stamp section_start on the first of each section). Both source and target days are rebuilt so section markers stay valid.
- Each column has an "edit" link that drops back to the single-day editor for fine edits.

Changes are local edits via the existing `update()` (structuredClone) helper, so the board mutates the same `programme` state the editor saves on "Save changes". Verified: tsc clean, production build passes. In-browser drag-drop click-through needs Pedro's session.

### Exercise Library: pinned detail panel + clearer selected card (2026-05-22)

### Exercise Library: pinned detail panel + clearer selected card (2026-05-22, LATEST)

Pedro's pain on /dashboard/pt/exercises: when hunting for exercises with no video he scrolls deep, clicks a card, but (a) the selected state was barely visible and (b) the detail/edit panel sat top-right so he had to scroll all the way up to use "Find video", then back down.

Root cause of (b): the view is built as a fixed-height two-pane (grid scrolls internally, detail panel pinned beside it via `sticky top-0 h-full`), but the height chain is all `min-h-[calc(...)]` (dashboard/layout main, pt/layout, view root `h-full`) - no DEFINITE height - so `h-full` collapses, the inner `overflow-y-auto` never engages, the whole PAGE scrolls, the header scrolls away, and the sticky panel scrolls off with it.

Fix in PTExercisesView.tsx (chose the low-risk path - did NOT re-architect the dashboard height chain):
- Detail panel is now `position: fixed` (inset-x-3 top-3 bottom-3 on mobile; md:right-3 md:w-96 lg:w-[28rem]) with rounded corners + shadow, z-40. It pins to the viewport, so clicking any card - regardless of scroll - shows the edit/video panel immediately. Verified no ancestor sets transform/filter/will-change/contain in globals.css, so fixed pins to the viewport (not a containing block).
- The grid pane gets right padding when a card is selected (md:pr-[26rem] lg:pr-[30rem]) so the rightmost cards are not hidden behind the fixed panel. On mobile the grid still hides when selected (panel is a full-width overlay).
- Selected card state is now obvious: emerald-500 border + ring-2 ring-emerald-500 ring-offset-1 + bg-emerald-50 + shadow + scale-[0.97], an `active:scale-[0.96]` press feel on click, and an emerald check badge in the thumbnail corner.

Verified: tsc clean, production build passes. In-browser confirmation (click a card deep in the list, panel appears pinned without scrolling) needs Pedro's session.

NOTE: a cleaner long-term fix would be to give the Exercise Library view a definite height so its internal two-pane scroll works (header fixed, grid scrolls, panel static beside it). That needs the dashboard height chain (min-h -> h on the layout main + pt/layout) and was deferred to avoid affecting other dashboard pages. The fixed-panel approach solves Pedro's pain without that risk.

### (Codex) Programme day exercise feed internally scrollable

### Programme day editor internal exercise-feed scroll (2026-05-22, LATEST)

Pedro asked for the exercise edit card/controls to stay visible while scrolling exercises, or alternatively to keep the screen static and only scroll the exercise feed.

Change:
- `PTDayEditor.tsx` now wraps the editor in a fixed-height flex column (`max-h-[calc(100dvh-15rem)]`, `min-h-[28rem]`, `overflow-hidden`).
- The week-block selector and exercise action header remain outside the scroll region.
- Only the grouped exercise list scrolls (`min-h-0 flex-1 overflow-y-auto overscroll-contain pr-2`).
- Because `PTDayEditor` is shared, this applies to `/dashboard/pt/programmes/[id]/edit`, the programme wizard, and template editor.

Verification:
- `npm run build` passes.
- Browser verification was attempted against the existing dev server on `http://localhost:3001`, but Playwright dropped the page to `about:blank`, so the final check is build + code inspection. Pedro should visually confirm in his logged-in browser.

Goals achieved:
- Editing controls no longer scroll away with long exercise lists.
- The fix is shared across programme edit, new programme wizard, and template edit because all use `PTDayEditor`.
- No schema, Supabase, or Edge Function changes were needed.

Items needing attention:
- Visual click-through still needs Pedro's logged-in browser because Playwright dropped to `about:blank`.
- If Pedro specifically wants a separate right-side detail card later, `PTDayEditor` would need a larger layout refactor from inline row editing to selected-row detail editing.

Next steps:
- Open a long workout day in `/dashboard/pt/programmes/[id]/edit`.
- Confirm the week selector/action header stays visible while only the exercise feed scrolls.
- If the fixed height feels too short or too tall on Pedro's laptop, tune `max-h-[calc(100dvh-15rem)]`.

### Multi-programme toggle on the client profile (2026-05-22, LATEST)

Pedro wanted: a client (e.g. Thaisa, 7e0023d9) can have multiple programmes assigned, shown stacked on their profile, each with an animated on/off switch on the right. Only ONE is active at a time (the one the client sees); toggling one on switches the others off; toggling the active one off leaves none active.

Data model: `pt_program_assignments.status` is plain `text`. Active = status `'active'`; the client portal (ClientPortal.tsx) loads assignments with `.eq('status','active')` and uses `assignments[0]`. So "one active" = exactly one row at `'active'`; everything else is `'paused'`.

Changes in `PTClientDetail.tsx` (the only file touched):
- Added `assignmentList` local state seeded from the `assignments` prop, re-synced via `useEffect` on prop change (so optimistic toggles animate instantly and a router.refresh() re-syncs truth). `activeAssignment` now derives from `assignmentList`.
- `setActiveProgramme(id)`: optimistic update, then DB writes. Turning one ON: set all other assignments for the client to `'paused'`, set the target `'active'`. Turning the active one OFF: set just it to `'paused'`. Then router.refresh(); on error, re-sync from props.
- Programme section heading is now "Programmes"; renders every assignment stacked with name, phases/weeks, an Active/Off pill, an Edit link, and an animated pill toggle (h-6 w-11, knob translate-x with 300ms transition, green when active). When there are zero assignments, the original "assign from template" empty state is kept; when there are assignments, a collapsed `<details>` lets Pedro assign another from a template.

Note: existing data can have multiple `'active'` rows (Thaisa has 2 - both created via flows that insert `'active'` without pausing others). The toggle resolves this the first time Pedro uses it (activating one pauses the rest). The wizard/template-assign create paths were NOT changed to auto-pause others - the toggle is the authoritative control. If you want the invariant enforced at creation too, pause other client assignments in PTProgrammeWizard.save() and assignProgramme().

Verified: tsc clean, production build passes. The toggle's DB writes use the browser client under the same RLS the page already uses for assignments. In-browser click-through (animate + persist + client portal reflects the switch) needs Pedro's logged-in session.

### Text-to-workout builder + drag-drop phase reordering (2026-05-22)

### Text-to-workout builder + drag-drop phase reordering (2026-05-22, LATEST)

Two coach-flexibility features for the programme editor (/dashboard/pt/programmes/[id]/edit).

**1. Drag-drop phase reordering (commit 1034d91).** Phases in the editor can be dragged by the handle to reorder (e.g. move a new phase above 1RM Test). Native HTML5 DnD (matches PTDayEditor; @dnd-kit/sortable is not installed). movePhase() in PTProgrammeEditView reorders programme.phases; "starts week X" labels recompute automatically from order via getPhaseStartWeeks.

**2. Text-to-workout builder - a SEPARATE mechanism from the main 3-AI generation.** In the editor's Workouts section there is now a "+ Build from text" panel: Pedro pastes a workout/phase in his own words, and it is structured, library-linked, and added as a new phase he can drag into position. This is the flexibility lever he asked for - author programming by hand but still get real exercise_ids, videos, and canonical section order.

How it works (edge function build-workout-from-text, verify_jwt true, deployed):
- STEP 1 parse: Claude (sonnet-4-6, 4096 tok, 60s abort, repair-parse) turns the text into days -> sections (Warm Up/Workout/MetCon/Stretches) -> exercises (sets/reps/rest/superset/notes), names normalised, no ids yet.
- STEP 2 match: loads pt_exercises, fuzzy-matches each name (normalise: lowercase, expand bb/db/kb/rdl/ohp, strip punctuation; exact then containment) -> exercise_id + video_url, flags misses.
- STEP 3 research+create: ONE Claude batch call researches all missing exercises (muscles, equipment, cues, setup_cues, tags, conditions), inserts pt_exercises rows (source 'ai', video_url null for Pedro to backfill), gets ids.
- STEP 4 assemble: orders each day by canonical section, sets section_start on first of each section, links exercise_id/video_url/cues, returns a PTProgrammePhase + created_exercises + matched/missing counts.
The UI (PTProgrammeEditView buildFromText) appends the returned phase via makeId, switches to its tab, and reports what was matched/created. Pedro then drags it into position and Saves.

Verified end-to-end: minted a session for pedro@cerebroai.au, sent a 5-section workout text; HTTP 200 in ~20s, 7 matched, 1 missing ("90/90 Hip Switch") researched + created with a real exercise_id and full card data (equipment, muscles, 6 cues, 6 setup cues, tags), video_url null. UI is wired + type-checks + production build passes, but the in-browser click-through needs Pedro's logged-in session.

Skills (Pedro's workflow-architect breakdown, built in ~/.claude/skills/): pt-text-to-workout (chain head) -> pt-text-to-workout-parse -> pt-exercise-library-match (reused) -> pt-exercise-create-missing (reused; already researches+fills cards) -> pt-text-to-workout-assemble. These are the local Claude Code path mirroring the edge function (same pattern as the main pipeline having both a skill chain and edge functions).

### Programme drafts: autosave + 24h auto-delete (2026-05-22)

Pedro generated a programme, was editing on wizard step 3, navigated away without pressing Create on step 4, and lost his work. Built draft persistence so this cannot happen again. He chose (via prompt): autosave the generated programme AND his manual edits; hard-delete drafts after 24h.

What a "draft" is: a `pt_program_generation_runs` row that has a `programme_draft` but was never turned into an assignment (Create on step 4 is what inserts pt_program_templates + pt_program_assignments). These already surface in the Programmes page "Drafts & review queue" section and open via the review page's "Open draft in editor" button (loads the draft into the wizard via sessionStorage draftKey). So resume already existed - the gap was that edits were only written to the DB on Create.

Changes:
1. **Autosave (PTProgrammeWizard.tsx).** A debounced (1.2s) effect writes the current `programme` back to `pt_program_generation_runs.programme_draft` (and name/goal into `validation_summary.name`/`.goal`) whenever it changes after generation (generationRunId set, not generating, step >= 2). Watches the `programme` state so it captures every edit path. RLS already lets pedro@cerebroai.au UPDATE the run (review page updateRunStatus uses the same client-side update).
2. **Resume keeps edited name/goal (PTProgrammeReviewView.tsx).** openDraft now prefers `run.validation_summary.name`/`.goal` over the assignment/client fallback.
3. **Drafts UI (PTProgrammesView.tsx + page.tsx).** Section renamed "Drafts & review queue"; page query passes `saved` (whether an assignment references the run); unsaved resumable drafts get a "Draft" pill and an "expires in Xh" hint from created_at + 24h.
4. **24h cleanup cron (migration 20260522165333_delete_stale_program_drafts.sql).** pg_cron job `delete-stale-program-drafts` runs hourly, calls `public.delete_stale_program_drafts()`, deleting runs older than 24h NOT referenced by any assignment or template. Child rows cascade; assignment/template back-links SET NULL, so no real programme is destroyed. Applied to remote AND mirrored as a repo migration. Job confirmed active.

Verified: tsc clean, production build passes. Cron active; dry-run predicate shows nothing past TTL yet. Pedro's lost programme is recoverable - run eea683bb (Mira, created 2026-05-22 06:32 UTC, 5-phase draft intact) is safe until ~06:32 UTC 2026-05-23. Recover via Programmes -> Drafts & review queue -> Mira -> "Open draft in editor". NOTE: the live wizard click-through (generate -> edit -> leave -> reopen and see edits) needs Pedro's logged-in browser; the DB/cron/RLS layer is verified and the React autosave is wired + type-checks, but was not click-tested this session.

### Programme generation: the JSON-failure + synthesis-hang fix (2026-05-22, VERIFIED WORKING)

Pedro reported the wizard failing at Step 1 with "Client analysis failed: Analysis did not return valid JSON" (run c5fc11ab). Root-caused and fixed end-to-end. A full generation for Mira (client d43808bb, the failing data-rich client) now completes: run b5adc76a reached needs_review in ~120s, validation passed=true, 5 phases, 127 exercises every one with exercise_id + video_url.

THREE bugs, all fixed:

1. **CLIENT_ANALYSIS returned invalid JSON (the reported failure).** Commit 94353b8 (the earlier "add 60s timeout" session) had reverted client-analysis-agent from max_tokens 4096 -> 2000 AND removed the JSON parse retry, to cut timeout exposure. For a data-rich client like Mira the analysis JSON exceeds 2000 tokens, truncates mid-object, parse returns null -> 502. Fix: max_tokens back to 4096, system prompt now demands COMPACT output (short excerpts, <=6 array items, complete self-closing JSON), and parseJson is now repair-capable (closeTruncatedJson walks string/bracket state and closes a truncated object so a near-miss still parses). Same robust parser dropped into movement-analysis-agent and methodology-plan-agent (they had the same fragile parser + shrunk token budgets: 2500 and 3000).

2. **Orchestrator hung forever at PROGRAMME_SYNTHESIS_HYPERTROPHY (zombie run in 'running').** This is the long-standing "Promise.race only races headers" bug finally fixed properly. In callAgent, `const data = await res.json()` ran OUTSIDE the timeout race, so a stalled body-stream hung the orchestrator with no timeout, the EdgeRuntime background task got killed mid-run, and the run stayed 'running' forever. Fix: the fetch AND the body read (res.text() + JSON.parse) now run inside a single async task that is raced against the timeout, so callAgent ALWAYS returns within timeoutMs. Worst case is a clean timeout failure, never a hang. The synthesis agent itself was never the problem - called directly it returns the hypertrophy phase in 1.6s.

3. **MOVEMENT_ANALYSIS aborted at 60s (regression I introduced, then fixed).** Bumping movement to 4096 tokens pushed its Claude call past the 60s internal abort -> "Request was aborted" -> wasted ~60s of pipeline wall-clock and likely corrupted the keep-alive connection that the next (hypertrophy) call reused. Fix: movement tokens set to 3000 and internal Claude abort raised to 85s (under the orchestrator's 95s budget for that step). Movement now succeeds (~60s) and the mind map is produced.

Deployed versions: client-analysis-agent v5, movement-analysis-agent (CLI redeploy), methodology-plan-agent (CLI redeploy), pt-programme-orchestrator (CLI redeploy). All verify_jwt false (unchanged).

Why this is durable for "every client every time": every agent that calls Claude now (a) has a token budget large enough for its schema, (b) keeps output compact, (c) recovers truncated JSON instead of 502-ing, and (d) is wrapped by an orchestrator that can never hang on a body read. The synthesis steps for known Cerebro phases (Foundation/Hypertrophy/Strength) are fully deterministic - no Claude call - so they cannot truncate or hang.

IMPORTANT for whoever picks this up: the WEBSITE pipeline = these Supabase edge functions, NOT the ~/.claude/skills/pt-* skill chain. The skills are the local Claude Code path Pedro can run from the terminal; they do not run when generating from the dashboard. Fixes for the dashboard belong in the edge functions and must be redeployed.

Cleared stuck/failed test runs: c5fc11ab (the original report), b8af67ba (debugging run, hung at hypertrophy before the orchestrator fix).

### EARLIER THIS DAY (superseded by the above)

### Programme generation pipeline - 3 rounds of stuck debugging (2026-05-22 afternoon, LATEST)

**THE CORE BUG (all 3 rounds share this root cause):**
`Promise.race([fetch, timeout])` in the orchestrator ONLY races HTTP response headers. Once a 200 OK header arrives from an agent, `res.json()` blocks indefinitely on body streaming. The orchestrator-level timeout never fires. Fix: every agent must internally abort its Claude SDK call with AbortController so it returns a complete HTTP response in bounded time.

**Round 1 (previous session, commit 90089c7):**
Stuck at: EXERCISE_INTELLIGENCE.
Fix: removed step entirely. `buildDeterministicPhase()` handles all phases without AI.

**Round 2 (this session, commit 94353b8):**
Stuck at: METHODOLOGY_PLAN.
Root cause: 5 sequential RAG calls + no Claude timeout in methodology-plan-agent.
Fix: RAG parallelised (Promise.allSettled + 15s each); 60s AbortController on Claude in methodology-plan-agent, client-analysis-agent, movement-analysis-agent.

**Round 3 (this session, commit fbf458f - LATEST):**
Stuck at: PROGRAMME_SYNTHESIS_1RM_TEST.
Root cause 1: synthesis agent had NO AbortController on Claude fallback. Zero timeout.
Root cause 2: pickBig5() used regex name matching. DB names are "Back Squat", "Pull Up" not "BB Squat" etc. "/pull[- ]?up/i" matched "Archer Pull-Up" first (alphabetically). "/shoulder press/i" could match "DB Shoulder Press" before "Overhead Press". Wrong exercises = fallthrough to Claude unnecessarily.
Pedro's direction: "1RM phases are always the same - Big 5, 5x1. Don't spend tokens on them."

Fixes deployed:
- `pt-programme-orchestrator` (v11): detects 1rm_test/1rm_retest inline, builds Big 5 workout from hardcoded IDs, records step succeeded, skips synthesis agent for both 1RM phases entirely.
- `programme-synthesis-agent` (v12): 60s AbortController on Claude fallback; pickBig5() now uses hardcoded DB IDs.

Big 5 IDs (stable, hardcoded in both files):
- Back Squat: 3b551e61-9b4c-412d-82f5-a5a34c44c770
- Conventional Deadlift: 743c5231-e1e4-4d45-aee6-b7d0d3c17723
- Barbell Bench Press: 7baa12b2-9949-4e0c-8f72-1f7a801050fa
- Overhead Press: a85f183d-2b6b-47a1-b5ff-5881bb15cb3f
- Pull Up: 4e4392c7-b6f0-4bd2-94fa-fae97e360e22

Stuck run cleared: e655e39a for Mira Juka - was stuck at PROGRAMME_SYNTHESIS_1RM_TEST, patched to failed.

**Current pipeline (v11 orchestrator, all synthesis deterministic - no Claude calls in synthesis):**
CLIENT_ANALYSIS (60s max) -> MOVEMENT_ANALYSIS (95s max, non-fatal) -> METHODOLOGY_PLAN (75s max) -> FOUNDATION (instant) -> 1RM TEST (instant, inline) -> HYPERTROPHY (instant) -> STRENGTH (instant) -> 1RM RETEST (instant, inline) -> VALIDATION (instant)
Expected: 3-4 min total.

Next step: Pedro retries generation. If stuck again, run /pt-run-patcher then check pt_program_generation_steps to see which agent step hung.

---

### Programme generation pipeline fix - Round 1 (2026-05-22, previous session)

Root cause (deeper): `Promise.race([request, timeout])` in the orchestrator only races HTTP response *headers* arrival. Once a 200 OK header is received, `res.json()` blocks indefinitely waiting for the full response body. The body-streaming is outside `Promise.race`, so the 40s (later 95s) timeout had no effect on it. The `exercise-intelligence-agent` could stream its JSON body for 60-120s with no way to cancel it from the orchestrator.

**Nuclear fix:** Completely removed the `EXERCISE_INTELLIGENCE` step from the orchestrator pipeline. The `programme-synthesis-agent` has a full `buildDeterministicPhase()` that generates complete workouts for all 5 phases without exercise intelligence. Non-fatal loss.

Fixes shipped (commit 90089c7):
- `pt-programme-orchestrator` (v10): EXERCISE_INTELLIGENCE removed entirely. `exerciseMasterList = []`, `staplesByPhase = undefined`. Step numbering corrected. Comments explain the body-streaming root cause.
- `PTProgrammeWizard`: polls `pt_program_generation_steps` in parallel to show completed steps with elapsed time in real-time. On failure or 7-min timeout → back to step 1 with error. EXERCISE_INTELLIGENCE removed from `commandLabel()` and `PIPELINE_STEPS`.
- Created `~/.claude/skills/pt-run-patcher/SKILL.md`: skill to auto-detect and patch stuck runs (status=running, older than 10 min). Invoke proactively before retries.
- Cleared all previously stuck `running` runs in DB.
- Edge function `pt-programme-orchestrator` redeployed as v10.

**Current pipeline (v10):** CLIENT_ANALYSIS → MOVEMENT_ANALYSIS → METHODOLOGY_PLAN → PROGRAMME_SYNTHESIS × 5 → VALIDATION

Status: Generation should complete reliably. Pedro can retry.

## Previous: Programme editor week-scope UX fixes

Pedro asked for programming-side fixes in the programme wizard/editor:
- When editing a day with multiple week groups, changing an exercise must be able to affect only one selected week group, e.g. `Week 3-7`, while keeping `Week 1-2` unchanged.
- After editing a workout day, there should be a clear `Save` button so Pedro can repeat the workflow day by day.
- Exercise autocomplete dropdowns needed a solid off-white background for readability.

Fixes shipped:
- `PTDayEditor` week-block selector now explicitly says what the edit affects: `All weeks` or one week group.
- Exercise swaps, typed exercise names, video URLs, cues, and notes now store into `week_overrides` when a week group is selected. `All weeks` still edits the base exercise.
- Added `getExerciseForBlock()` in `utils/pt/programme.ts` and preserved block exercise fields through `safeProgramme()`.
- Client portal and PT Sessions now resolve block-specific exercise overrides so the edited week group shows the correct exercise later.
- Added a `Save` button to the day editor step. It advances to the next day when available, otherwise returns to the day list.
- Autocomplete dropdowns now use `exercise-autocomplete no-glass` with a solid `#f7f4ef` background and black text.

Verification:
- `npm run build` passes.
- Playwright browser verification was attempted but the browser transport was closed in this session. A dev server was already running on `http://localhost:3001`.

## Previous: Exercise video backfill

Pedro asked to use the previous YouTube-search path to populate all exercise cards without videos.

Operational data update:
- Used existing deployed Supabase function `search-exercise-videos`.
- Pre-check: `pt_exercises` had 39 missing `video_url` values out of 656 exercises.
- Invoked the function in batch mode with the service-role token.
- Function result: `{ "populated": 39, "missing": [] }`.
- Post-check: `pt_exercises` now has 0 missing `video_url` values out of 656 exercises.

No app code changed for this task.

## Previous: Exercise library missing-video filter

Pedro asked for a filter next to "All categories" to show exercises without a video URL linked to the exercise card.

Fix in `app/dashboard/pt/exercises/PTExercisesView.tsx`:
- Added `videoFilter` state.
- Added a new select beside category filter:
  - `All video statuses`
  - `Missing video URL`
- Filtering now excludes exercises with a non-empty `video_url` when `Missing video URL` is selected.

Verification:
- `npm run build` passes.
- `npx eslint app/dashboard/pt/exercises/PTExercisesView.tsx` has 0 errors and one pre-existing `<img>` warning.

## Previous: Exercise Library card selection UX polish

Pedro confirmed the exercise PDF import is now working, then asked for three UX fixes on `/dashboard/pt/exercises`:
- Import button text was black on a black button unless hovered.
- Selected exercise card became an oval/pill shape.
- Exercise detail panel on the right was not staying in the current viewport when selecting cards lower down the list.

Fix in `app/dashboard/pt/exercises/PTExercisesView.tsx` and `app/globals.css`:
- Added `exercise-import-button` override so the import button stays black with white text and white icon in normal and hover states.
- Added `exercise-library-tile` / `exercise-library-tile-active` classes to protect cards from broad dashboard glass button rounding.
- Active card now stays card-shaped, lifts slightly, gets an emerald border, and shows a subtle green glow.
- Detail panel now has a ref and resets its own scroll when a new exercise is selected.
- Detail panel is sticky within the Exercise Library viewport.

Verification:
- `npm run build` passes.
- `npx eslint app/dashboard/pt/exercises/PTExercisesView.tsx` has 0 errors and one pre-existing `<img>` warning.
- Browser screenshot verification was not possible because the Playwright transport was closed in this session.

## Previous: Wizard UX overhaul (Claude Sonnet 4.6, 2026-05-22)

Pedro wanted the programme wizard UX to match his coaching workflow exactly:

1. Step 1 - client select + doc upload + brain dump -> click Generate -> immediately go to Step 2
2. Step 2 (loading) - live progress bar + pipeline step list (all 12 steps with checkmarks as they complete)
3. Step 2 (done) - phase overview grid: 5 cards (Foundation, Testing 1RM, Hypertrophy, Strength, Retesting 1RM), each showing week count + day count + week_block pills
4. Step 3 - click a phase -> workouts show up -> edit exercises per day -> click Next
5. Step 4 ("Review & create") - review programme summary -> click "Create programme for [name]" -> programme assigned to client

Changes shipped in `PTProgrammeWizard.tsx` (commit 680aa48):
- Added `PIPELINE_STEPS` constant (12 strings matching `genStatus` values the poller emits)
- `handleGenerate` calls `setStep(2)` immediately before async pipeline starts (navigation is instant)
- Step 2 replaced with IIFE that renders: loading animation (when `generating`) -> error message (on failure with no phases) -> phase overview grid (when done)
- Progress bar width driven by `PIPELINE_STEPS.indexOf(genStatus) / total` -> smooth 0-100% tracking
- Step indicator labels: Generate -> Review -> Edit -> Create
- Step 4 heading: "Review & create"
- Step 4 button: "Creating..." / "Create programme for [name]"

TypeScript compiles clean. Committed and pushed.

The Playwright browser was locked during this session so browser testing is pending - the next session should open `/dashboard/pt/programmes/new`, verify the 5 flow steps above, and confirm the Create button writes to `pt_program_assignments` with status 'active' and navigates to the client page.

## Previous: PDF import fix (Codex, 2026-05-22 morning)

Pedro retried the PDF import and hit an error in the import modal. Supabase Edge Function logs showed `import-exercises` version 2 returned HTTP 500 after ~48 seconds. Diagnosis: `pt_exercises` has a `pt_exercises_source_check` constraint allowing only `manual`, `spreadsheet`, or `ai`; the OpenAI migration inserted rows with `source: 'openai-import'`, so the database rejected the batch.

Fix:
- `supabase/functions/import-exercises/index.ts` now inserts `source: 'ai'`, which satisfies the existing DB constraint.
- Redeployed `import-exercises`; Supabase now reports it ACTIVE as version 3 with `verify_jwt: true`.
- Import modal changed from glass/white-translucent styling to a solid off-white popup (`#f7f4ef`) with stronger text contrast, stronger dropzone contrast, and higher-contrast error/status messages.

Verification:
- `npm run build` passes.
- `npx eslint app/dashboard/pt/exercises/PTExercisesView.tsx` has 0 errors and one pre-existing `<img>` warning.
- Supabase schema check confirmed source constraint: `manual`, `spreadsheet`, `ai`.
- Supabase function list confirmed `import-exercises` version 3 ACTIVE.

## Previous OpenAI switch

Pedro asked whether the exercise document importer can use the OpenAI / ChatGPT API instead of Claude. The answer is yes, and the function has been changed.

Change in `supabase/functions/import-exercises/index.ts`:
- Removed Anthropic SDK usage from `import-exercises`.
- Added a small `generateTextWithOpenAI()` helper that calls `https://api.openai.com/v1/responses`.
- Uses `OPENAI_API_KEY`.
- Uses `OPENAI_EXERCISE_IMPORT_MODEL` if configured, otherwise defaults to `gpt-4.1` to match the current project’s existing OpenAI model usage.
- Keeps the same importer contract: the UI still sends `document_text`, the function extracts names, dedupes against `pt_exercises`, enriches details in batches of 50, inserts normal exercise cards, and returns `{ added, skipped, exercises }`.
- Inserted rows now use `source: 'openai-import'` so OpenAI-imported cards can be identified later.

Deploy:
- `supabase functions deploy import-exercises` completed successfully on project `otcnrkfvgyvwolironoz`.
- Supabase function list confirms `import-exercises` is ACTIVE, version 2, `verify_jwt: true`.

Verification notes:
- Deployment succeeded.
- I did not run a full production import from chat because this function requires a real authenticated user JWT, not just the service role key. Test through the dashboard upload modal while logged in.

## Previous PDF import fix

Pedro tried importing `/Users/pedroavila/Downloads/The TRUE Ultimate Master Exercise Directory (Unabridged).pdf` from `/dashboard/pt/exercises`. The modal displayed the PDF as loaded, then `import-exercises` failed. Root cause: the Exercise Library import modal only supported `.txt/.csv/.md/.tsv` and read files with `FileReader.readAsText`; when a PDF got through, it sent PDF binary-ish text to the `import-exercises` Edge Function instead of extracted exercise content. The file itself is not too large: local pdf.js extraction returned 21 pages and 21,751 characters.

Fix in `app/dashboard/pt/exercises/PTExercisesView.tsx`:
- Import modal now accepts `.pdf` and max 20 MB.
- PDF files are posted to the existing `/api/pt/parse-pdf` route before calling `import-exercises`.
- Text files still use direct text extraction.
- Modal copy now says `.pdf · .txt · .csv · .md`.
- Moved `ArrayField` to module scope to satisfy the React Compiler lint rule in this touched file.

Verification:
- `npm run build` passes.
- `npx eslint app/dashboard/pt/exercises/PTExercisesView.tsx` has 0 errors and one pre-existing `<img>` warning.
- Full `npm run lint` still fails because the repo lint includes existing `.claude/worktrees` and unrelated legacy errors.
- Direct local POST to `/api/pt/parse-pdf` with Pedro's PDF returned `200 OK` and clean exercise text.

Skill workflow created in the parent project `skills/` directory and registered in parent `AGENTS.md`:
- `pt-exercise-import-diagnose`
- `pt-exercise-import-extract-text`
- `pt-exercise-import-extract-names`
- `pt-exercise-import-dedupe`
- `pt-exercise-import-insert`

Each skill has an explicit completion gate and invokes the next step only after its artifact exists. This is the canonical local workflow for diagnosing and safely importing exercise documents.

## Previous major handoff

Pedro hit Generate on the wizard. Run `148389c3-511a-4caa-8e68-d7152b4822bf` hung at EXERCISE_INTELLIGENCE forever. Direct test of `exercise-intelligence-agent` edge function: 130s timeout with no response on real input, 114s with a 502 "did not return valid JSON" on tiny input. Root cause: the Claude call asks for 140+ exercises in one JSON (7 primary_issues x ~2 muscles x 10 exercises), exceeds max_tokens 4500 mid-JSON, parse fails, retries also fail, total runtime exceeds 150s edge limit. The orchestrator's 95s AbortController timeout did not fire in the deployed background task - stuck run remained in `running` status forever; wizard surfaced "Pipeline still running" message.

Decision: stop trying to fix the edge function. Decompose Step 2 into a 5-skill local Claude Code chain that Pedro runs from his terminal. Rationale: edge functions in this project have hit 150s/400s timeouts repeatedly (see learning-log). Local skills have no platform timeouts, each step is visible, and each step's output must complete before the next can run.

Chain head changed: `pt-movement-analysis` -> `pt-exercise-per-muscle` (was `pt-exercise-intelligence`).

New local sub-chain in `~/.claude/skills/`:
- `pt-exercise-per-muscle` (Step 2a) - LLM, one muscle at a time, 10 exercises each
- `pt-exercise-library-match` (Step 2b) - pure code, fuzzy match against pt_exercises
- `pt-exercise-create-missing` (Step 2b.5) - auto-create pt_exercises rows for unmatched exercises with video_url null; Pedro adds YouTube links later. Guarantees no exercise in the chain has a null exercise_id - library never blocks programme quality.
- `pt-exercise-double-duty` (Step 2c) - pure code, dedup + tag double-duty exercises
- `pt-exercise-staples` (Step 2d) - small LLM call, standard + client-specific staples
- `pt-exercise-finalize` (Step 2e) - pure code, assemble payload + persist to pt_client_exercise_doc

Old monolithic `pt-exercise-intelligence` skill moved to `~/.claude/skill-archive/pt-exercise-intelligence-superseded-2026-05-21/`. Stuck run marked failed in DB. Edge function `exercise-intelligence-agent` still deployed but should not be called.

Next time Pedro runs programme generation: invoke `pt-movement-analysis` in Claude Code (not the wizard). The chain self-advances through Steps 1 -> 2a -> 2b -> 2c -> 2d -> 2e -> 3 (`pt-programme-builder`) -> 4 (`pt-programme-validator`).

Production wizard left as-is. Edge function path parked until/unless we want a self-serve coach UI.

## YOU ARE HERE - 2026-05-22 (read this first, 60 seconds)

### Project goal

Cerebro is Pedro Avila's AI automation consultancy and PT coaching platform. The cerebro-site is a Next.js + Supabase app that includes a CRM-style leads dashboard, a PT client management system (programmes, nutrition, workouts, messaging), a landing page, a chatbot, and a pitch deck generator.

The current chapter: the PT programme creation wizard is structurally complete and producing correct programmes. The focus is now refinement, UX polish, and making the coach flow feel seamless end-to-end.

### What was just shipped (commit 680aa48, 2026-05-22)

**Wizard UX overhaul.** Pedro's required 5-step flow is now wired in `app/dashboard/pt/programmes/new/PTProgrammeWizard.tsx`:

1. **Step 1** - select client, upload docs (PDF/txt/md), add brain dump, click Generate -> immediately jumps to Step 2
2. **Step 2 loading** - PIPELINE_STEPS constant (12 strings) drives a live progress bar + step list with checkmarks. Each `genStatus` string from the poller matches a PIPELINE_STEPS label exactly. Takes 3-7 min.
3. **Step 2 done** - 5 phase cards (Foundation, Testing 1RM, Hypertrophy, Strength, Retesting 1RM) with week count, day count, week_block pills. Click "Edit exercises".
4. **Step 3** - click phase tab, click day card, edit exercises. Click "Finish".
5. **Step 4** - "Review & create" heading. Button reads "Create programme for [name]". Creates pt_program_templates + pt_program_assignments (status=active, coach_review_status=approved), fires pt_events (event_type=programme_assigned), navigates to client page.

TypeScript compiles clean. Production build passes. Committed and pushed (commit 680aa48, then b5f224f for HANDOFF).

### What is pending - do this first in the next session

**Browser test the wizard end-to-end.** In the 2026-05-22 session, browser tools were unavailable (Playwright MCP server was accidentally killed by pkill; Chrome extension not connected). Start a fresh Claude Code session to reconnect Playwright automatically.

Test checklist:
1. Open `/dashboard/pt/programmes/new`
2. Pick John Wick (6fbd4d9b) - has the richest test data from the local programme generation session
3. Click Generate (no files needed - brain already has data) -> confirm immediate Step 2 transition
4. Watch the 12-step list animate; confirm progress bar tracks genStatus strings correctly
5. After generation: 5 phase cards appear -> click "Edit exercises"
6. Edit one exercise on one day -> click Finish
7. Review & create screen shows "Create programme for John Wick" button
8. Click Create -> confirm redirect to `/dashboard/pt/clients/6fbd4d9b...`
9. SQL: `select status, coach_review_status, name from pt_program_assignments order by created_at desc limit 1;` - expect status=active, coach_review_status=approved

### The pipeline

The AI pipeline (pt-programme-orchestrator) runs async:
- CLIENT_ANALYSIS -> MOVEMENT_ANALYSIS -> EXERCISE_INTELLIGENCE -> METHODOLOGY_PLAN -> PROGRAMME_SYNTHESIS_FOUNDATION -> PROGRAMME_SYNTHESIS_1RM_TEST -> PROGRAMME_SYNTHESIS_HYPERTROPHY -> PROGRAMME_SYNTHESIS_STRENGTH -> PROGRAMME_SYNTHESIS_1RM_RETEST -> VALIDATION
- Polls pt_program_generation_runs.current_command every 3s
- On completion: programme_draft + validation_summary written to the run row

### Nutrition UX (shipped earlier, 2026-05-22)

NutritionTab.tsx has drag-and-drop between meal sections, tap-to-edit macro sheet (weight change scales macros proportionally), and estimated weight per food card. log-nutrition-batch uses weight-first estimation.

### Next refinement tasks

Ordered by impact. These are independent - pick any.
- **Browser test** (above) - blocks all other UX confidence
- **Task #22** - Meso/deload labels in the editor: group week_blocks as "Meso 1 (weeks 1-4)" with Build/Peak/Deload sub-labels
- **Task #24** - Per-exercise swap picker: library autocomplete drawer with video preview
- **Task #17** - RPE targets per phase alongside %1RM
- **Task #25** - Client-facing weekly view with resolved kg targets

Full task list (#17-#32) is in the "Next on the list: refine and improve" section further down this file.

If you have access to `~/.claude/projects/.../memory/` (Claude only), the memory entry `project_pt_programming_overhaul_vision.md` has the full architecture and implementation status. The plan file `~/.claude/plans/we-need-to-run-drifting-waffle.md` has Session 1/2/3 progress narratives. Codex cannot see those; everything you need is in this file and the git repo.

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
this commit - Reorder PT programmes and collapse templates

## Current state

Dashboard and client portal use the liquid glass design direction from the Claude Design handoff bundle, with the client portal refined toward a lighter premium coaching cockpit.

Shipped most recently:
- Weekly tonnage Phase 2 is live for client profiles and the client app overview. Added `weekly_tonnage`, deployed `compute-client-tonnage`, and added the shared `TonnageSummaryCard`. Client overview now shows "You moved" below Workout and above Nutrition. Pedro's client profile Progress column now shows the same previous-week and month-to-date card. Client workout saves and coach PT Session saves now trigger a background recompute after exercise classification. Live smoke test on Stephen Layfield returned previous week 55,327 kg and month-to-date 63,164 kg, and REST verified cached rows for weeks starting 2026-06-29 and 2026-07-06.
- Programme phase builder reliability update: `rebuild-programme-phase` v5 now has a deterministic fallback writer. If the AI writer times out or returns incomplete JSON, the function still returns an editable phase draft using the selected phase, requested day count, Big 5 spread, safe superset rules, and existing week blocks. The builder UI now shows an in-progress percentage bar, and the voice button preflights microphone access with clearer Chrome permission guidance.
- Fixed phase rebuild generation timing out after context loading. `rebuild-programme-phase` v4 now sends a smaller writer prompt, removes web-search tools from the writer call, caps writer output/time, stores timeout failures cleanly, and returns handled generation errors as JSON the UI can show. Two stale timed-out phase rebuild runs were marked failed in `pt_program_generation_runs`.
- Programme phase rebuild UI now keeps disabled agent buttons readable on the light programme editor surface. The live `rebuild-programme-phase` Edge Function now tells the chat/writer agent not to pair two big/main lifts in one superset by default and also enforces that during assembly by splitting a second main lift into its own superset id. Deployed `rebuild-programme-phase` v3 on Supabase project `otcnrkfvgyvwolironoz`.
- M & L client intelligence export has been moved into a top-of-profile collapsible `M & L` card on `/dashboard/pt/clients/[id]`. The card shows saved assessment notes, video count, generated intelligence docs, PDF state, a progress bar with background status, and Generate/Regenerate PDF. M & L assessment notes are no longer mixed into the generic Notes list.
- `generate-ml-client-profile` Edge Function now catches AI timeout/failure and writes a structured fallback client intelligence document instead of returning a hard 500. It records generation mode and error details in document analysis and returns a warning to the UI. The function was deployed to project `otcnrkfvgyvwolironoz`.
- Public Movement Assessment intake is live at `/movement-assessment`. It is a two-step prospect flow: Pedro Avila Coaching PAR-Q with signature, then live booking slots from `pt_booking_availability`/`pt_booking_blocks`. Successful booking creates or updates a `pt_clients` card, inserts a confirmed 50-minute appointment and block, and stores all PAR-Q answers, client note, booking metadata, and signature in an active `pt_client_notes.context` record visible on the client detail page. No migration was needed.
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
- Nutrition onboarding activity buttons now match the screenshot wording, use larger single-card padding with safer wrapping, and update selected state immediately on touch.
- Nutrition onboarding now shows a dedicated creation screen after the client submits height, weight, and activity level. It includes a percentage progress ring and rotating guidance about phase-linked nutrition, meal context, plate photo quality, and 10-20% tracking variance.
- Workout logger section note cards now use a larger mic button in the top-right corner so the voice action is easier to hit.
- Programme creation Step 3 import now accepts up to 8 screenshots, and the import modal commit action is enabled for text-only, image-only, or mixed text-plus-image inputs.
- Nutrition tab now shows a collapsed `Nutrition journey` dropdown with a checkpoint-style rail, a one-line goal summary, phase week labels, and the `Track your food` CTA moved above it. The old `Nutrition programme created` banner is cleared after onboarding success.
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
- Supabase CLI linked queries can hit temp-role auth failures on the pooler. If the migration/function already succeeded, verify table state through the REST API with the service role key instead of retrying `supabase db query` repeatedly.
- Full repo lint has pre-existing failures outside recent work. Prefer targeted build/type verification.
- Pre-commit hook rejects em dashes in markdown files. Use plain hyphens.
- Supabase Cron job `pt-booking-weekly-reminders` is active on project `otcnrkfvgyvwolironoz` with schedule `0 22 * * 4`, which maps to Friday morning Sydney time in the current timezone.
- `send_session_alerts` action is ready in `manage-pt-booking` but needs a daily cron set up in Supabase Dashboard (e.g. `0 22 * * *` = 8am Sydney daily). Use the same internal secret bearer pattern as weekly reminders.
- Google Calendar sync is wired in `manage-pt-booking` through `GOOGLE_CALENDAR_SYNC_URL` or `GOOGLE_CALENDAR_ACCESS_TOKEN` plus `GOOGLE_CALENDAR_ID`. No Google secret was present locally, so calendar writes will no-op until one of those secrets is configured.
- Coach booking notifications: `COACH_NOTIFY_EMAIL` defaults to `pedro@cerebroai.au`, `COACH_CALENDAR_EMAIL` defaults to `avila.phm@gmail.com`. Coach calendar attendance only fires when the existing Google Calendar sync secrets are set. The email piece works as long as `RESEND_API_KEY` is set.
- Resend email sending uses existing `RESEND_API_KEY` and `RESEND_FROM_PEDRO_NOTIFY` Edge Function secrets when available.
- Security advisor still reports `pg_net` installed in `public` from the live project. Attempting `ALTER EXTENSION pg_net SET SCHEMA extensions` is not supported by the extension, so this was left as an existing non-blocking warning rather than dropping/recreating the extension on a live project.
