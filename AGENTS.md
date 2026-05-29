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

## Leads Dashboard - Current State

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

## Frontend design - ALWAYS use the Impeccable skill

Any time you build, redesign, review, or polish UI on this site - and **especially anything under `app/coach/` (the pedroavila.coach personal brand site)** - use the **`impeccable`** skill. It is Pedro's chosen design system layer: it gives the agent a real design vocabulary (`/impeccable polish`, `/impeccable audit`, `/impeccable critique`, `/impeccable colorize`, `/impeccable typeset`, `/impeccable animate`, etc.) and a deterministic anti-pattern detector, so generated UI is craft-quality instead of generic AI slop (Inter + purple gradient + nested cards + gray-on-color).

Why this is a rule, not a suggestion: Pedro asked that Impeccable be invoked whenever we work on the website. Default frontend output drifts to sameness; Impeccable is how he keeps pedroavila.coach distinctive and on-brand.

How to apply:
- Before finishing any UI change on the coach site (or any landing/marketing page), run an Impeccable pass (`/impeccable audit <surface>` then `/impeccable polish <surface>`), respecting existing CSS tokens / brand colors.
- Reach for the relevant Impeccable sub-command when the task names a design concern (typography, color, spacing, motion, hierarchy, anti-patterns).
- The skill auto-triggers on frontend/design work, but treat it as required here, not optional.

---

## Active Plan
No active plan file, saved phase list, or stored todo list is currently maintained. Treat new work as a clean slate and use Pedro's current brief.

---

## Session Protocol (mandatory - Claude and Codex both follow this)

**Session start:**
1. Read `HANDOFF.md` - tells you exactly where to pick up and what's next
2. Read `../session-logs/learning-log.md` - past mistakes by both Claude and Codex. Do not repeat them.

**Session end (before stopping):**
1. Update `HANDOFF.md`: fill in Last updated, Last completed task, Last commit, and current state
2. `git add -A && git commit -m "[description]" && git push`

**Never stop a session with uncommitted changes or a stale HANDOFF.md.**
