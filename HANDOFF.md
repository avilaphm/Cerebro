# Handoff

## Last updated
2026-05-11 by claude

## Last completed task
PT Dashboard Revamp complete. Tidy-up: unread message count on overview, deleted PTDashboard.tsx, archived plan.

## Last commit
9f4885e -- tidy-up after Phase 5

## Current state

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
- `generate-pt-programme`, `invite-pt-client`, `delete-pt-client`: unchanged

**Storage pattern:** `document_url` stores the storage PATH (e.g. `{client_id}/{timestamp}-filename.pdf`), NOT a public URL. Signed URLs generated on demand via `supabase.storage.from('pt-client-docs').createSignedUrl(path, seconds)`.

### Old PTDashboard.tsx
Deleted. No longer exists.

### Leads dashboard
- Phase 1 complete, Phase 2+ pending Pedro re-brief
- Pipeline at `/dashboard/leads`

## Next task
PT Dashboard Revamp fully complete and cleaned up. No outstanding work scoped. Pedro to brief next feature.

## Known issues / notes
- Do NOT run `supabase db push`. Remote migration history is ahead of local. Use `supabase db query` or MCP `apply_migration`
- Full repo lint has pre-existing failures outside PT code. Do not fix.
- Pre-commit hook rejects em dashes in .md files -- use plain dashes
