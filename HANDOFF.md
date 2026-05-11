# Handoff

## Last updated
2026-05-11 by claude

## Last completed task
Full PT dashboard MVP built, tested, and all invite/auth/delete bugs resolved. Client onboarding flow works end to end.

## Last commit
5a1ddaf - Add sign out to client portal; show back-to-dashboard link for Pedro

## Current state

### Leads dashboard (Phase 1 complete, Phase 2 pending)
- Pipeline board: 4 columns (Stage 1, Call Booked, Client, Nurture)
- QuadProgress on each card: Q1 fresh lead, Q2 email sent, Q3 proposal viewed, Q4 booking clicked
- Tag system: `utils/leads/tags.ts` with TAG constants, computeStage(), addTag(), removeTag(), hasTag()
- Lead detail page + LeadActions + MilestoneStrip
- Phase 2+ scope not yet defined - Pedro will re-brief when ready

### PT dashboard (active work)
- Route: `/dashboard/pt`
- Client portal: `/client` (with `/client-login` magic link and `/client-setup` password setup)
- Supabase tables: pt_clients, pt_exercises, pt_program_templates, pt_program_assignments, pt_workout_logs, pt_set_logs, pt_events
- Edge functions deployed: generate-pt-programme, invite-pt-client, delete-pt-client, weekly-pt-summary
- Client invite flow: Pedro invites from PT dashboard, client gets email, clicks link, lands on /client-setup (sets password), redirected to /client
- Delete client: calls delete-pt-client edge function which removes pt_clients row AND auth user (so email can be reused)
- Session separation: client portal shows "Sign out" for clients, "Back to dashboard" for Pedro

### Known issues / notes
- Supabase migration history is clean (repaired today)
- Full repo lint has pre-existing failures outside PT code - do not fix these without Pedro asking
- Do NOT run `supabase db push` without checking migration list first

## Next task
Continue building out the PT dashboard. Pedro will brief specific features at session start.
Ask Pedro: "What do you want to build on the PT dashboard next?"

## Open issues / blockers
- Leads dashboard Phase 2 scope unknown - Pedro will re-brief separately when ready
- PT dashboard is functional MVP - next features TBD by Pedro
