# Handoff

## Last updated
2026-05-11 by codex

## Last completed task
PT Dashboard Programming MVP implemented and deployed to Supabase.

## Last commit
Latest commit is `Build PT dashboard programming MVP`; run `git log --oneline -1` for the exact hash.

## Current state
- Pipeline board fully functional: 4 columns (Stage 1, Call Booked, Client, Nurture)
- QuadProgress on each card: Q1 fresh lead, Q2 email sent, Q3 proposal viewed, Q4 booking clicked
- Tag system complete: `utils/leads/tags.ts` with TAG constants, STAGE1_QUARTERS, computeStage(), addTag(), removeTag(), hasTag()
- Lead detail page + LeadActions + MilestoneStrip wired up
- call_booked tag auto-moves lead to Stage 2 column via webhook
- Supabase tables: leads + lead_tags (with source field)
- Session continuity system installed (this file + Stop hook + git tags)
- PT Dashboard route added at `/dashboard/pt` under Overview
- Client portal route added at `/client`, with `/client-login` magic-link entry
- PT Supabase tables created remotely: pt_clients, pt_exercises, pt_program_templates, pt_program_assignments, pt_workout_logs, pt_set_logs, pt_events
- PT Edge Functions deployed: generate-pt-programme, invite-pt-client, weekly-pt-summary
- Pedro/admin access is allowed via profiles role or known Pedro emails; clients redirect away from `/dashboard` to `/client`

## Next task
Test the PT Dashboard with Pedro logged in, import the first exercise CSV, create a test client, generate a test programme, assign it, and confirm client logging works with a real invited client account.

## Open issues / blockers
- `supabase db push` is blocked because remote migration history contains versions not present locally. The PT schema was applied with `supabase db query --linked -f ...`; do not run migration repair casually.
- Full repo lint still fails due to older pre-existing issues outside the PT implementation. Targeted PT lint, TypeScript, and build pass.
