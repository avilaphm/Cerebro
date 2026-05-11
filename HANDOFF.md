# Handoff

## Last updated
2026-05-11 by codex

## Last completed task
Improved mobile client UX and fixed PT chat realtime/latency.

## Last commit
PENDING - mobile client UX and chat latency fix

## Current state

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
- `generate-pt-programme`, `invite-pt-client`, `delete-pt-client`: unchanged

**Storage pattern:** `document_url` stores the storage PATH (e.g. `{client_id}/{timestamp}-filename.pdf`), NOT a public URL. Signed URLs generated on demand via `supabase.storage.from('pt-client-docs').createSignedUrl(path, seconds)`.

### Old PTDashboard.tsx
Deleted. No longer exists.

### Leads dashboard
- Phase 1 complete, Phase 2+ pending Pedro re-brief
- Pipeline at `/dashboard/leads`

## Next task
Programme progression system complete. Pedro to test and brief next feature.

## Known issues / notes
- Do NOT run `supabase db push`. Remote migration history is ahead of local. Use `supabase db query` or MCP `apply_migration`
- Full repo lint has pre-existing failures outside PT code. Do not fix.
- Pre-commit hook rejects em dashes in .md files -- use plain dashes
