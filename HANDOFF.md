# Handoff

## Last updated
2026-05-12 by codex

## Last completed task
Completed Client Lifestyle Coaching OS Phase 2.

## Last commit
client lifestyle phase 2 weekly plans

## Current state

### Client Lifestyle Coaching OS Phase 2 (NEW)
- Added local migration `20260512070331_client_lifestyle_phase_2_weekly_plans.sql`.
- Applied the Phase 2 schema remotely with `supabase db query --linked -f ...`; did not run `supabase db push`.
- New DB tables: `pt_weekly_plans`, `pt_weekly_plan_items`.
- New Edge Function deployed: `draft-weekly-plan` version 1 on project `otcnrkfvgyvwolironoz`.
- `/dashboard/pt/clients/[id]` Coaching panel now includes a weekly plan builder:
  - week picker
  - manual plan drafting
  - AI weekly draft generation from client context, latest reset, goals, metrics, notes, and active programme
  - regular slot tracking and slot confirmation state
  - plan item linking to programme days
  - draft save and client publish actions
- Supported weekly plan item types:
  - `pt_session`
  - `solo_strength`
  - `run`
  - `golf_mobility`
  - `recovery`
  - `nutrition`
  - `check_in`
- `/client` now shows the published weekly plan:
  - client-facing week note
  - due today / next item summary
  - full plan list
  - mark-done / skip for non-workout items
  - linked workout items open the existing workout flow
  - finishing a linked workout auto-completes the matching plan item
- `/dashboard/pt/overview` now includes coaching operations widgets:
  - weekly resets waiting
  - plans not published
  - clients with no plan this week
  - open loops
  - metrics due
- Focused advisor rerun for `pt_weekly_plans` and `pt_weekly_plan_items` returned clean after consolidating overlapping RLS policies.
- Verification:
  - `npm run build` passed
  - remote tables confirmed with `supabase db query`
  - `supabase functions list` shows `draft-weekly-plan` active
  - browser smoke test on a local dev server confirmed `/client` redirects to `/client-login` and `/dashboard/pt/clients` redirects to `/login`
  - Playwright console errors on local dev were HMR websocket handshake noise, not app logic errors

### Client Lifestyle Coaching OS Phase 1 (NEW)
- Added local migration `20260512034559_client_lifestyle_phase_1.sql`.
- Applied migration remotely with `supabase db query --linked -f ...`; did not run `supabase db push`.
- New DB tables: `pt_weekly_checkins`, `pt_client_metrics`, `pt_client_goals`, `pt_coaching_tasks`.
- Extended `pt_clients` with `lifestyle_context`, `regular_training_slot`, `coaching_focus`, and `event_goal`.
- `/client` now has a coaching home above Training:
  - This Week overview
  - Weekly Reset form
  - Body metrics entry
  - Active goals display
- Weekly reset submissions create open `pt_coaching_tasks` for Pedro.
- Metric submissions create open `pt_coaching_tasks` for Pedro.
- `/dashboard/pt/clients/[id]` now has a Coaching panel:
  - Client 360 fields
  - latest weekly reset summary
  - energy/soreness/sleep/stress scores
  - latest metrics
  - active goals
  - open coaching tasks with Done action
- Pedro can add goals and mark weekly resets reviewed from the client detail page.
- Verification: `npm run build` passed. Remote schema verified with `supabase db query`. Supabase advisors have no warnings for the four new Phase 1 tables. Browser smoke checked `/client` and a real `/dashboard/pt/clients/[id]` route.

### PT Programming Agent (NEW)
- Client profile now has a `Programming Agent` panel.
- For clients without an active programme, Pedro can draft a new programme from the client profile.
- For clients with an active programme, Pedro can draft a revision.
- The panel accepts optional text or voice instructions.
- New Supabase Edge Function deployed: `pt-programming-agent` version 2 on project `otcnrkfvgyvwolironoz`.
- The agent gathers client profile data, uploaded document, active feedback notes, recent messages, workout logs, set logs, active assignment, exercise library, and Pedro programming principles.
- Agent outputs are draft-only and stored in browser `sessionStorage`.
- New programme drafts open the existing new programme wizard prefilled for review.
- Revision drafts open the existing programme edit route with unsaved generated changes loaded.
- Existing Create/Save buttons remain the only points where programme assignments are written.
- Local verification: `npm run build` passed. Browser smoke test reached `/dashboard/pt/clients` and redirected to login without client-side console errors.

### Phase progression block parsing (NEW)
- Programme edit and new programme wizard now parse both set progressions and percentage progressions.
- Supported examples:
  - `2 sets for 2 weeks, 3 sets for 3 weeks, 4 sets for 4 weeks`
  - `75% for 1 week, 85% for 3 weeks, 90% for 4 weeks`
- Pressing `Done` on a phase now reapplies/parses the current progression text before closing, so existing text is not ignored.
- Workout editor block tabs now show either set targets or percentage targets.
- Exercise rows now inherit block-level `% 1RM` targets the same way they already inherited block-level set targets.
- Client workout display now shows block-level percentage targets when a phase uses percentage progression.

### Client workout notes + weekly progress (NEW)
- Each workout section now has a `Submit note` button under `Notes for Pedro`.
- Client-submitted section notes insert immediately into `pt_client_notes`, so they appear on the PT client profile card.
- Added `pt_client_notes.context` JSON metadata and a client insert policy for workout section notes.
- Remote migration applied: `client_workout_notes`.
- Section notes are cleared on the client side after submit, so they do not keep appearing when the client returns to that workout.
- Client progress now displays the current block split by weeks, with completed workout count per week.
- When a client completes all workouts for a week, the assignment `current_week` updates to the next week, not only when the whole block changes.
- PT client notes now show workout context and an `Open fix` link when the note came from a workout section.
- Programme edit opened from a note shows a fix banner. Saving changes or clicking `Done` marks the note inactive and removes it from the client card.

### PT client account status + password controls (NEW)
- Client sign-out from `/client` now forces the browser to `/client-login`.
- Expired or already-used client auth hash links now stay on `/client-login?error=...` instead of sending clients to the generic `/login`.
- PT client detail now shows a separate `Client login page` button next to `Resend login link` for live clients.
- Follow-up redirect fix: client auth callbacks now normalize nested `next` URLs and route client users to `/client` instead of falling back to the generic Cerebro dashboard login.
- Legacy implicit auth hash handling now detects client profiles and routes them to `/client`; `/client-login` also mounts that handler.
- Client login, invite, and password reset links now build callback URLs with `URLSearchParams` so `next=/client` is preserved reliably.
- Redeployed `invite-pt-client` and `manage-pt-client-password` after callback URL fixes.
- `/dashboard/pt/clients/[id]` Account card now shows `Live` when the client is active, has created a password, has a login event, or has workout activity.
- Client setup now sets `pt_clients.status = active` when the client creates their password, preventing active clients from staying in an awaiting setup state.
- Added a `Password` panel on the PT client detail page.
- Password panel can send a Supabase password reset email to the client.
- Password panel can generate a new temporary password through a secured admin Edge Function and display that newly created password once.
- Current passwords are not viewable because Supabase stores password hashes only.
- `/client-login` now includes a `Forgot password?` flow.
- Recovery callbacks preserve `next=/client`, and `/auth/update-password` redirects the client back to the right dashboard after the password is changed.
- New Edge Function deployed: `manage-pt-client-password` version 1 on project `otcnrkfvgyvwolironoz`.
- `npm run build` passed.

### Mobile client UX + chat latency fix (NEW)
- `/client` workout screens have tighter mobile-first spacing, smaller mobile headings, larger touch targets, safe bottom padding, and phone-friendly set inputs.
- Client message bubble opens as a native-feeling bottom sheet on phones instead of a small desktop popup.
- `pt_messages` is now added to the `supabase_realtime` publication on the live Supabase project and `replica identity full` is set.
- Local migration added: `supabase/migrations/20260511000300_enable_pt_messages_realtime.sql`.
- Client chat now optimistically renders the message immediately after insert, then invokes note extraction asynchronously.
- Client chat polls every 2.5s while open and every 10s while closed as a fallback if realtime lags.
- PT dashboard messages also optimistically render sent messages and poll every 3s for the selected client.
- Realtime publication verified remotely with `pg_publication_tables`.

### Client exercise demo + history UI (NEW)
- Client workout logging cards now show a small YouTube video screen under the exercise name when `video_url` exists.
- Clicking the video screen opens a full-screen video overlay.
- Full-screen video unmounts on close and listens for YouTube end events to close when playback finishes.
- Each exercise can show a "Verbal cues" toggle with up to 5 cues from the exercise library/spreadsheet data.
- Previous logged set weights are shown in a "Last time" strip.
- Weight inputs are prefilled from the client's latest logged weights for that exercise, set-by-set where available.
- Added sets inherit the matching previous set weight, or the last available previous weight.

### Client workout flow (NEW)
- `/client` now shows one active phase at a time instead of every phase/exercise.
- Active phase displays workout cards only.
- Clicking a workout opens a preview screen showing the full day, grouped by programmed sections.
- "Begin workout" opens the logging screen.
- Logging screen uses collapsible section cards (e.g. Warm up, Main work), with all exercises for that section inside the card.
- Clients can log weight and reps for each set.
- Programmed set count is preloaded, but clients can add or remove sets per exercise.
- Each section has "Notes for Pedro" after the section exercises.
- Finishing a detailed workout writes `pt_workout_logs`, `pt_set_logs`, section notes, and counts toward progression/block advancement.

### PT client auth link fix (NEW)
- `/dashboard/pt/clients/[id]` resend button now distinguishes client account state:
  - clients without `password_created_at`: sends setup link to `/client-setup`
  - clients with `password_created_at`: sends login link to `/client`
- `invite-pt-client` edge function now falls back to a setup magic link if a first-time invite hits an already-created Supabase Auth user.
- `/client-login` now supports normal email + password login, with a secondary one-click login link option.
- `invite-pt-client` deployed to Supabase as version 6 on project `otcnrkfvgyvwolironoz`.
- `npm run build` passed after fixing the programme override type predicate.

### Programme progression system (NEW)
- `PTProgrammePhase.week_blocks` -- per-phase progressive overload blocks: [{weeks, sets}, ...]
- Wizard step 2 + edit view: text + voice input for week blocks, parsed from natural language, shown as chips
- `/dashboard/pt/programmes/[id]/edit` -- standalone edit route for any assigned programme
- "Edit programme" link on client card active assignment
- "Resend login link" button on client card (was "Send invite")
- Client portal: "Workout done" button on every day card, green Done badge, progress strip per phase
- Block auto-advancement: when all days for all weeks in a block are done, auto-advance to next block
- Sets displayed per exercise dynamically reflect current block
- DB: current_week, current_block_index on pt_program_assignments; block_index, is_quick_done on pt_workout_logs

### PT Dashboard (Phases 1-4 complete)

**Routes live:**
- `/dashboard/pt` redirects to `/dashboard/pt/overview`
- `/dashboard/pt/overview` live widgets: client count, worked out (7d), needs attention (14d), needs programming, sessions low, recent activity
- `/dashboard/pt/clients` all clients grid + Add client modal, note badges from AI extraction
- `/dashboard/pt/clients/[id]` full client card: edit inline, status, sessions, password status, last login, programme assignment, PDF upload + signed URL view, send invite, delete, AI notes with dismiss
- `/dashboard/pt/messages` WhatsApp-style chat: Supabase realtime, context chips (phase/day), marks read on open
- `/dashboard/pt/programmes` list of templates + assignments + "New programme" button
- `/dashboard/pt/programmes/new` 4-step AI wizard: select client + generate from PDF / brain dump + voice, edit phase cards, build workouts per day (drag/drop), save + assign to client
- `/dashboard/pt/groups` create/delete groups with colour chips, manage members per group
- `/dashboard/pt/emails` placeholder (sequences coming later)
- `/dashboard/pt/settings` exercise library CSV import + searchable exercise grid

**Client portal:**
- Floating MessageBubble (bottom-right) with real-time chat, context chip (current phase/day), unread badge
- After client sends message: `extract-client-note` edge function auto-extracts important info (injuries, travel, dislikes) into `pt_client_notes`, shown as amber badges on client card in PT view

**DB tables/columns live (remote):**
- `pt_clients`: sessions_remaining, document_url, password_created_at
- `pt_messages`: id, client_id, sender, content, read_at, context (jsonb), created_at
- `pt_client_notes`: id, client_id, source_message_id, content, is_active, created_at
- `pt_groups` + `pt_group_members`
- Storage bucket: `pt-client-docs` (private, admin upload/read)
- `pt_messages` has REPLICA IDENTITY FULL for realtime

**Edge functions deployed:**
- `parse-client-document`: gets client PDF from Storage via signed URL, uploads to OpenAI Files API, processes with Responses API + file_id, returns PTProgramme JSON. Falls back to text file content or client goals/notes.
- `extract-client-note`: GPT-4.1-mini analyzes client messages for notable info, inserts to pt_client_notes if relevant
- `manage-pt-client-password`: sends reset links or sets a new temporary password for PT clients, admin-only
- `generate-pt-programme`, `invite-pt-client`, `delete-pt-client`: unchanged

**Storage pattern:** `document_url` stores the storage PATH (e.g. `{client_id}/{timestamp}-filename.pdf`), NOT a public URL. Signed URLs generated on demand via `supabase.storage.from('pt-client-docs').createSignedUrl(path, seconds)`.

### Old PTDashboard.tsx
Deleted. No longer exists.

### Leads dashboard
- Phase 1 complete, Phase 2+ pending Pedro re-brief
- Pipeline at `/dashboard/leads`

## Next task
Client Lifestyle Coaching OS Phases 1-2 are complete. Next continuation point is Phase 3 from `plans/2026-05-client-lifestyle-coaching-os.md`: progress tracking, planned-vs-completed review, and Pedro weekly/monthly review summaries.

## Known issues / notes
- Do NOT run `supabase db push`. Remote migration history is ahead of local. Use `supabase db query` or MCP `apply_migration`
- Full repo lint has pre-existing failures outside PT code. Do not fix.
- Pre-commit hook rejects em dashes in .md files -- use plain dashes
