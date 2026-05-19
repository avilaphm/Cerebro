# Handoff

## Last updated
2026-05-19 by Codex

## Last completed task
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
current HEAD - PT programming architecture Phase 3 knowledge retrieval system

## Current state

Dashboard and client portal use the liquid glass design direction from the Claude Design handoff bundle, with the client portal refined toward a lighter premium coaching cockpit.

Shipped most recently:
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
