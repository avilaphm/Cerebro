# Handoff

## Last updated
2026-05-16 by Claude

## Last completed task
Per-client AI coach + voice brain dump + PT knowledge brain (commit c95cbce):
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
c95cbce - Add per-client AI coach, voice brain dump, and PT knowledge brain chat

## Current state

Dashboard and client portal use the liquid glass design direction from the Claude Design handoff bundle, with the client portal refined toward a lighter premium coaching cockpit.

Shipped most recently:
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
