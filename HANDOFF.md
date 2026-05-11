# Handoff

## Last updated
2026-05-11 by claude

## Last completed task
PT Dashboard Revamp Phase 1: full navigation restructure + Clients section. Single-page tab layout replaced with 7 sub-routes. Client cards with password status, session pack, PDF upload, and programme assignment. Live overview dashboard.

## Last commit
(see git log)

## Current state

### PT Dashboard (Revamp Phase 1 complete)

Architecture changed: `/dashboard/pt` is now a sub-routed app with its own PT sidebar nav.

**Routes live:**
- `/dashboard/pt` redirects to `/dashboard/pt/overview`
- `/dashboard/pt/overview` live widgets: client count, worked out, needs programming, recent workouts, sessions low
- `/dashboard/pt/clients` all clients grid + Add client modal
- `/dashboard/pt/clients/[id]` full client card: edit name/goals/notes, status, sessions remaining, password status, last login, programme assignment, PDF upload, send invite, delete
- `/dashboard/pt/messages` placeholder (Phase 3)
- `/dashboard/pt/groups` placeholder (Phase 5)
- `/dashboard/pt/programmes` read-only list (Phase 4 = full AI wizard)
- `/dashboard/pt/emails` placeholder (Phase 5)
- `/dashboard/pt/settings` placeholder (Phase 5)

**New DB columns/tables applied to remote:**
- `pt_clients`: sessions_remaining int, document_url text, password_created_at timestamptz
- `pt_messages` table (with RLS: admins see all, clients see own)
- `pt_groups` + `pt_group_members` tables
- Storage bucket: `pt-client-docs` (private, admin upload/read)

**`/client-setup` now sets `password_created_at`** on the pt_clients row after password creation.

**Active plan:** `plans/2026-05-pt-dashboard-revamp-v2.md` (Phase 2 next: full messages; Phase 4: AI programme wizard)

### Old PTDashboard.tsx
Still exists at `app/dashboard/pt/PTDashboard.tsx`. No longer rendered (page.tsx redirects). Safe to delete once all functionality is confirmed migrated. Library and Activity tabs not yet migrated (deferred to Phase 5 Settings and Phase 3 overview respectively).

### Leads dashboard
- Phase 1 complete, Phase 2+ pending Pedro re-brief
- Pipeline at `/dashboard/leads`

## Next task
Phase 3: Messages. Full WhatsApp-style chat UI between Pedro and clients.
- Build `app/dashboard/pt/messages/page.tsx` as 'use client' with Supabase real-time subscription
- Add messages to client portal (`app/client/ClientPortal.tsx`)
- `pt_messages` table is already live

Or Pedro may want Phase 4 (AI Programme Wizard) first. Ask at session start.

## Known issues / notes
- Do NOT run `supabase db push`. Remote migration history is ahead of local. Use `supabase db query` or MCP `apply_migration`
- Full repo lint has pre-existing failures outside PT code. Do not fix.
