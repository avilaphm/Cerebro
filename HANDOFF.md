# Handoff

## Last updated
2026-05-13 by codex

## Last completed task
Implemented client-facing PT booking system.

## Last commit
implement pt client booking system

## Current state

Client booking system has been added across Supabase, PT dashboard, and client portal.

Shipped in this session:
- New PT booking tables for availability, appointments, public-safe busy blocks, session ledger, cancellation requests, and notification logs.
- New `manage-pt-booking` Supabase Edge Function deployed to project `otcnrkfvgyvwolironoz`.
- New `/dashboard/pt/bookings` cockpit for Pedro to manage availability, add packs, manually book sessions, complete sessions, cancel sessions, and review late cancellation requests.
- Client `/client` portal now opens on Overview, moves workouts behind a bottom Workout tab, and adds a Tools tab for booking Pedro.
- Client booking rules are server-side: 7 days minimum notice, 28 day horizon, recurring bookings inside the horizon, credit holds for future bookings, cancellation request inside 24 hours.

Recent shipped surfaces include:
- `/dashboard/bookings` internal booking cockpit backed by Supabase booking tables.
- `/dashboard/leads` lead pipeline and tag-based stage tracking.
- `/dashboard/pt` PT dashboard, client portal, programme, messaging, coaching, and review workflows.
- Public marketing routes including `/`, `/finance`, `/operators`, `/blog`, `/privacy`, and `/terms`.

## Clean Slate Rules
- There are no active saved phase lists.
- There are no active saved todo lists.
- Do not infer next work from deleted plans.
- For new work, use Pedro's current brief.

## Known Notes
- Do not run `supabase db push`. Remote migration history is ahead of local. Use `supabase db query` or MCP migration paths.
- Full repo lint has pre-existing failures outside recent work. Prefer targeted build/type verification.
- Pre-commit hook rejects em dashes in markdown files. Use plain hyphens.
- Google Calendar sync is wired in `manage-pt-booking` through `GOOGLE_CALENDAR_SYNC_URL` or `GOOGLE_CALENDAR_ACCESS_TOKEN` plus `GOOGLE_CALENDAR_ID`. No Google secret was present locally, so calendar writes will no-op until one of those secrets is configured.
- Resend email sending uses existing `RESEND_API_KEY` and `RESEND_FROM_PEDRO_NOTIFY` Edge Function secrets when available.
