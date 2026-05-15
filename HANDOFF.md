# Handoff

## Last updated
2026-05-15 by Claude

## Last completed task
Booking session rules overhaul (commit 0bd4e22):
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
0bd4e22 - Booking session rules: no-show, remove holds display, fix canBook

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
