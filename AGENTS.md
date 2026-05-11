<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes - APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Cerebro Site - Agent Context

## Project
Cerebro is Pedro Avila's AI automation consultancy. This is a Next.js + Supabase app with a CRM-style leads dashboard, landing page, chatbot, and pitch deck generator.

**Owner:** Pedro Avila (Sydney-based, Brazilian-born PT and AI builder)
**Stack:** Next.js (App Router), TypeScript, Supabase (Postgres + Auth), Tailwind CSS

---

## Leads Dashboard - Current State (Phase 1 complete)

### Files
```
app/dashboard/leads/
  page.tsx                    - Pipeline board: 4 columns (Stage 1, Call Booked, Client, Nurture)
  QuadProgress.tsx            - 4-quadrant pie indicator shown on each lead card
  [id]/page.tsx               - Lead detail page
  [id]/LeadActions.tsx        - Actions panel (mark lost, delete, etc.)
  [id]/MilestoneStrip.tsx     - Milestone strip on detail page

utils/leads/tags.ts           - Full tag system: TAG constants, STAGE1_QUARTERS,
                                computeStage(), addTag(), removeTag(), hasTag()
```

### Supabase tables
- `leads` - core lead records
- `lead_tags` - tags with `source` field: `auto` / `manual` / `webhook` / `system`

### QuadProgress layout (locked - do not change)
- Q1 = fresh lead (top-left)
- Q2 = email sent (top-right)
- Q3 = proposal viewed (bottom-right)
- Q4 = booking clicked (bottom-left)
- Q1 + Q2 sit side-by-side across the full top half

### Key decisions (do not revisit)
- `STAGE1_QUARTERS` simplified: removed `email2_sent`, added `call_booked` as Q4
- "Mark call booked" removed from LeadActions - booking auto-sets tag via webhook
- `call_booked` tag auto-moves lead to Stage 2 column (already wired)
- Pipeline columns: Stage 1 → Call Booked → Client → Nurture

---

## Coding conventions
- TypeScript strict - no `any`
- Supabase client from `lib/supabase/` (check existing pattern before importing)
- Tailwind only - no inline styles, no CSS modules
- Server components by default; add `'use client'` only when needed
- No comments unless the WHY is non-obvious
- No placeholder/mock data - all data comes from Supabase

---

## Active plan
Full plan at: `../plans/2026-05-leads-dashboard-revamp.md`
- Phase 1: COMPLETE (foundation, pipeline, tag system, QuadProgress, detail view)
- Phase 2+: Pedro will brief scope at session start

**Before writing any code:** ask Pedro what Phase 2 goal is if it is not already stated in the task.

---

## Session Protocol (mandatory - Claude and Codex both follow this)

**Session start:**
1. Read `HANDOFF.md` - tells you exactly where to pick up and what's next
2. Read the active plan at `../plans/2026-05-leads-dashboard-revamp.md`
3. If "Next task" in HANDOFF.md says PENDING - ask Pedro for Phase scope before writing any code

**Session end (before stopping):**
1. Update `HANDOFF.md`: fill in Last updated, Last completed task, Last commit, Current state, Next task
2. `git add -A && git commit -m "[description]" && git push`
3. If a phase just completed: `git tag dashboard-v[N] && git push --tags`

**Never stop a session with uncommitted changes or a stale HANDOFF.md.**

**Git tag convention:**
- `dashboard-v1` = Phase 1 complete (already tagged)
- `dashboard-v2` = Phase 2 complete, etc.
- To roll back to a phase checkpoint: `git checkout dashboard-v[N]`
