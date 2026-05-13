# Handoff

## Last updated
2026-05-13 by codex

## Last completed task
Upgraded PT client booking calendar.

## Last commit
upgrade pt client booking calendar

## Current state

PT booking flow is live with client and coach calendar views, 45 minute sessions, 5 minute buffers, hosted Friday reminder automation, and non-blocking Google Calendar sync.

Shipped in this session:
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
- Google Calendar sync is wired in `manage-pt-booking` through `GOOGLE_CALENDAR_SYNC_URL` or `GOOGLE_CALENDAR_ACCESS_TOKEN` plus `GOOGLE_CALENDAR_ID`. No Google secret was present locally, so calendar writes will no-op until one of those secrets is configured.
- Resend email sending uses existing `RESEND_API_KEY` and `RESEND_FROM_PEDRO_NOTIFY` Edge Function secrets when available.
- Security advisor still reports `pg_net` installed in `public` from the live project. Attempting `ALTER EXTENSION pg_net SET SCHEMA extensions` is not supported by the extension, so this was left as an existing non-blocking warning rather than dropping/recreating the extension on a live project.
