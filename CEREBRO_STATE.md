# CEREBRO STATE

Generated: 2026-07-11. Sources: local codebase, Supabase project `otcnrkfvgyvwolironoz`, and current deployment configuration visible from the repository.

## 1. PRODUCT OVERVIEW

Cerebro is a Next.js/Supabase app that currently combines Pedro's public sites, AI consultancy/admin tools, and a PT coaching operating system. Today it is primarily used by Pedro as the trainer/admin, plus PT clients who access the client app.

Main flows that work end to end today:
- Public visitors can access public pages, privacy/terms, operator pages, blog content, and contact/chat style flows.
- Pedro can log in to `/dashboard`, manage PT clients, generate/edit/assign programmes, manage the exercise library, run PT sessions, handle bookings, payments, messages, nutrition, and content/social tools.
- Clients can log in via `/client-login`, open `/client`, view their dashboard, workouts, nutrition, bookings, settings, messages, programme journey, and complete/log workouts.
- Programme generation can use client documents, uploaded files, selected evidence, brain dump notes, equipment choice, and the exercise library to produce editable programme drafts.

Feature status:
- Public site, coach route, legal pages: solid.
- Admin auth gate and Pedro admin access: solid for one trainer, fragile for multi-trainer.
- PT client CRUD, invite, password management: solid.
- Client portal login and navigation: solid.
- Programme builder/editor, phase/week/day editing, board/list views: works but fragile.
- Exercise library, exercise search, bulk video finder: solid.
- PT session tracking, set logging, finish-session sync to programme: works but fragile.
- Weekly tonnage summaries: works but fragile because classification/data quality affects totals.
- Booking availability, appointments, session ledger: works but fragile.
- Stripe session top-ups and webhook handling: works but tied to one account.
- Nutrition onboarding, logging, recipes, next-meal suggestions: works but fragile.
- Client messaging and AI handoff: works but fragile.
- Client brain, documents, embeddings, weekly reviews: works but fragile.
- M & L assessment profile generation: works but fragile, has fallbacks.
- AI programme generation pipeline: works but fragile.
- Social/blog generation and posting: works but fragile and account-specific.
- Studio screen/camera recorder: half-built/fragile.
- Movement screening: half-built; later commentary/report/refinement layers are stubbed.
- AI edit-learning loop and global methodology distillation: half-built.
- Multi-trainer support: not built.

## 2. ARCHITECTURE

Tech stack:
- Frontend/server: Next.js 16 App Router, React 19, TypeScript.
- Styling/UI: Tailwind CSS v4, Lucide icons, Framer Motion, DnD Kit.
- Backend: Supabase Postgres, Auth, Storage, Edge Functions.
- AI: OpenAI API and Anthropic API from Supabase Edge Functions.
- Payments/email/social: Stripe, Resend, Google Calendar APIs, YouTube API, Meta/Instagram APIs, X/Twitter APIs.
- Hosting: Vercel for the Next.js app, Supabase hosted project `otcnrkfvgyvwolironoz`.
- Local media/ML: MediaPipe Tasks Vision assets vendored in `public/`.

Codebase structure:
- `app/`: Next.js routes. Public pages, `/dashboard`, `/client`, `/client-login`, API routes.
- `components/`: shared React components, including tonnage and UI elements.
- `utils/`: Supabase clients, admin client, PT utilities, programme/exercise helpers.
- `supabase/functions/`: Edge Functions for AI, booking, payments, nutrition, client brain, social, programme generation.
- `supabase/migrations/`: SQL migrations and RLS/policy changes.
- `supabase/templates/`: email/auth payload templates.
- `docs/`: implementation notes and PRDs.
- `public/`: static assets, coach media, MediaPipe assets.

Auth:
- Supabase Auth is used for admins and clients.
- Middleware redirects unauthenticated `/dashboard/*` to `/login` and `/client/*` to `/client-login`.
- Dashboard access is allowed when `profiles.role = 'admin'` or email is in `PEDRO_ADMIN_EMAILS`.
- Client access is based on the logged-in Supabase user matching `pt_clients.user_id`.
- There is no organisation/trainer tenancy model.

Supabase schema and RLS summary:

All public tables currently have RLS enabled. No public table has forced RLS enabled. Most PT client-facing tables include some client-owner policies through `pt_clients.user_id = auth.uid()`. Many admin policies are hardcoded to Pedro emails or allow all authenticated admins. The schema does not contain a consistent `trainer_id` or `organisation_id`.

| Table(s) | Purpose and key columns | RLS state |
|---|---|---|
| `profiles` | Auth profile: `id`, `email`, `full_name`, `role`. | User/admin access, global admin role. |
| `pt_clients` | PT client record: `id`, `user_id`, `name`, `email`, `status`, notes, goals, sessions, nutrition, Stripe/customer fields. | Client can read own row; admin policies use role/email. |
| `pt_program_assignments` | Client active programme: `client_id`, `template_id`, `programme`, current phase/week/block, status. | Client-owner plus admin/service policies. |
| `pt_program_templates` | Saved programme templates and generated drafts. | Admin/email scoped, no tenant key. |
| `pt_program_generation_runs`, `pt_program_generation_steps`, `pt_program_review_outputs` | AI generation run state, command inputs/outputs, validation, drafts. | Admin/service scoped, no client owner policy in practice. |
| `pt_exercises` | PT exercise library: name, muscles, equipment, video URL, cues, tags, progressions/regressions. | Admin readable/writable; global library. |
| `exercise_library`, `weekly_tonnage` | Canonical tonnage classification and per-client weekly tonnage. | Library is global; tonnage has client-owner policies. |
| `pt_workout_logs`, `pt_set_logs` | Client workout and set history: client, assignment, phase/week/day, exercise, reps, weight. | Client-owner plus admin policies. |
| `pt_booking_availability`, `pt_booking_appointments`, `pt_booking_blocks`, `pt_booking_cancellation_requests`, `pt_session_ledger`, `pt_extra_sessions` | PT schedule, booking, cancellations, credits. | Mixed admin/client-owner policies; availability is trainer-global. |
| `pt_payments` | Stripe payment records: client, Stripe session/payment IDs, amount, status. | Client-owner plus admin/service policies. |
| `pt_messages`, `pt_conversation_summaries`, `pt_notification_log` | Client/admin messaging, summaries, notification tracking. | Messages partly client-owner; summaries/logs admin/service. |
| `pt_client_documents`, `pt_client_brain`, `pt_client_brain_chunks`, `pt_client_brain_reports`, `pt_client_recent_activity`, `pt_client_notes` | Client evidence, embeddings, durable memory, notes, reports. | Mostly admin/service; some client-owner reads. |
| `pt_client_lifestyle_doc`, `pt_client_exercise_doc`, `pt_client_nutrition_doc`, `pt_client_metrics`, `pt_client_goals`, `pt_client_1rm_tests`, `pt_client_1rm_results` | Intake, assessment, metrics, goals, 1RM data. | Mixed client-owner/admin policies. |
| `pt_nutrition_logs`, `pt_phase_nutrition`, `recipes`, `next_meal_sessions` | Nutrition logging, phase targets, recipes, meal suggestions. | Client-owner plus admin policies. |
| `pt_checkin_sessions`, `pt_weekly_checkins`, `pt_weekly_plans`, `pt_weekly_plan_items`, `pt_client_weekly_wrapup` | Check-in sessions, weekly check-ins, plans, wrapups. | Mixed client-owner/admin policies. |
| `pt_groups`, `pt_group_members` | Client grouping. | Admin/email scoped, no trainer key. |
| `pt_knowledge_documents`, `pt_knowledge_chunks`, `pt_knowledge_retrieval_logs` | Knowledge/RAG documents and retrieval logs. | Admin/service scoped, global knowledge. |
| `pt_programme_staples`, `pt_ai_training_answers`, `pt_ai_training_status` | Trainer methodology/staples and AI training questionnaire. | Pedro-email scoped, not tenant aware. |
| `pt_events`, `pt_coaching_reviews`, `pt_coaching_tasks` | Coaching events, review outputs, task tracking. | Admin/service patterns. |
| `pt_email_templates`, `pt_movement_screening_rule_versions` | Email templates and movement screening rule versions. | Admin scoped/global. |
| `api_keys`, `blog_posts`, `social_drafts`, `tags` | API key records, blog/content/social drafts/tags. | Broad authenticated or admin policies; not tenant scoped. |
| `leads`, `lead_tags`, `lead_scopes`, `proposals`, `conversations` | Consultancy CRM, lead tracking, proposal/chat data. | Several broad authenticated or service-role-only policies. |
| `booking_settings`, `booking_availability_windows`, `booking_appointments` | Non-PT booking system. | Mixed owner/service/admin; effectively one owner. |
| `page_visits`, `site_events`, `chat_rate_limits` | Analytics, events, rate limiting. | Service-role-only. |

Storage buckets:
- `blog-headers`: public images.
- `pt-client-docs`: private client docs/uploads.
- `pt-email-assets`: public email images.
- `pt-knowledge-docs`: private knowledge docs.
- `pt-nutrition-logs`: private nutrition media.

Storage policies also contain Pedro-email admin checks. Some buckets have broad authenticated admin-style access rather than tenant ownership.

## 3. INTEGRATIONS & EXTERNAL SERVICES

Credential locations:
- Local development: `.env.local`.
- Production: Vercel environment variables and Supabase Edge Function secrets.
- Database-stored config: `api_keys`, social drafts/content tables, Supabase storage objects.
- Do not treat local `.env.local` as complete; several Edge Function secrets are expected only in Supabase/Vercel.

External services in use:
- Supabase: Auth, Postgres, Storage, Edge Functions. Project ID is hardcoded in config as `otcnrkfvgyvwolironoz`.
- Vercel: Next.js hosting. Local Vercel metadata points to project `cerebro`.
- OpenAI: used by multiple Edge Functions for programme generation, client chat, parsing, knowledge, reviews, imports, and nutrition. Several functions default to `gpt-5.6` unless overridden by env vars such as `OPENAI_TEXT_MODEL`.
- Anthropic: used by programme/intelligence functions with `ANTHROPIC_API_KEY` and Claude model defaults in code.
- Resend: transactional email for bookings, proposals, weekly wrapups, tests, notifications.
- Stripe: client payments and session top-ups through `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET`.
- Google Calendar: booking/calendar sync with Google OAuth credentials and calendar IDs.
- YouTube API: exercise video search and social/video analytics.
- X/Twitter API: X post generation/posting.
- Meta/Instagram API: social account integration and posting/insights.
- TikTok credentials exist in `.env.local`; implementation appears incomplete or not central.
- MediaPipe Tasks Vision: local browser movement screening assets.
- PDF/text parsing libraries: used for document ingestion and programme/document extraction.

Hardcoded account/environment assumptions found:
- Admin emails in code and RLS: `pedro@cerebroai.au`, `avila.phm@gmail.com`; legacy policies/code also reference `pedro@meetavila.com` and `pedroavila.phm@gmail.com`.
- Dashboard admin allow-list in `utils/pt/access.ts`.
- Coach hostnames in middleware: `pedroavila.coach`, `www.pedroavila.coach`.
- Client/login copy references Pedro directly.
- Booking defaults are Pedro-specific: `Australia/Sydney`, 45 minute PT sessions, 5 minute buffer, 12 hour minimum notice, 28 day booking horizon.
- Email fallbacks use Pedro addresses and `Pedro Avila Coaching`.
- Supabase cron/migrations reference the production Supabase project URL directly.
- Public assets include Pedro/client-specific media under `public/coach`.
- Social API credentials in env are single-account credentials.
- Stripe keys are single-account keys.
- Knowledge documents, exercise methodology, programme staples, and AI training data are global rather than per trainer.

## 4. SINGLE-USER ASSUMPTIONS

These are the main blockers to supporting multiple trainers.

| Assumption | Where it appears | Fix size |
|---|---|---|
| No consistent trainer/org model. | Most PT tables use `client_id`; many global tables have no `trainer_id`. | Significant rework. |
| `pt_clients.user_id` means client login, not trainer ownership. | `pt_clients`, client portal, RLS joins. | Significant rework. |
| Dashboard shows global data. | Admin pages query clients/programmes/bookings/exercises/leads without tenant scoping. | Significant rework. |
| Admin access is Pedro email/global admin role. | Middleware/layout/access helper, RLS, storage policies. | Moderate to significant. |
| Exercise library is global. | `pt_exercises`, `exercise_library`, search/generation. | Moderate if shared library; significant if trainer-specific overrides are needed. |
| Knowledge/RAG is global. | `pt_knowledge_documents/chunks`, retrieval functions. | Significant. |
| Trainer philosophy is Pedro-specific. | Programme prompts, skills, staples, methodology distillation, edit-learning tables. | Significant. |
| Bookings assume one trainer calendar. | PT booking availability, Google Calendar env, booking utilities. | Significant. |
| Payments assume one Stripe account. | Stripe env vars, payment functions, webhook. | Significant for marketplace; moderate for one platform account. |
| Email sender/notifications assume Pedro. | Resend env, templates, booking functions. | Moderate. |
| Social/blog tools assume Pedro's accounts. | Social routes/functions/env vars/content tables. | Significant. |
| Client app branding assumes Pedro. | Client UI copy, header text, public assets. | Easy to moderate. |
| RLS contains hardcoded emails. | Table/storage policies across PT, knowledge, social, blog. | Moderate. |
| `pt_ai_training_*` locked to one Gmail. | RLS policy uses `avila.phm@gmail.com`. | Easy to moderate. |
| API key/content tables are broad authenticated. | `api_keys`, `blog_posts`, `social_drafts`, `tags`, `leads`. | Moderate; security-sensitive. |
| Public domains are Pedro-specific. | Middleware host rewrite and site copy/assets. | Easy. |

Minimum multi-trainer path: add `trainers` or `organisations`, add `trainer_id` to clients, programmes, bookings, knowledge, templates, exercises/overrides, payments, email/social config, AI training tables, and content tables; replace hardcoded admin policies with tenant policies; update all dashboard queries and Edge Functions to scope by `trainer_id`.

## 5. AI PIPELINE

Programme generation is implemented mainly in Supabase Edge Functions. The orchestrated path uses `pt-programme-orchestrator` and agent functions such as client analysis, movement analysis, methodology planning, exercise intelligence, programme synthesis, and validation. Runs and step outputs are stored in `pt_program_generation_runs` and `pt_program_generation_steps`.

Inputs include selected client documents, PAR-Q/M & L/client brain evidence, uploaded programme/reference files, brain dump notes, equipment choice, exercise library data, previous programmes, edit history, and trainer methodology data.

Trainer preference injection currently comes from several places:
- Prompt text inside Edge Functions.
- Pedro-specific methodology tables such as `pt_programme_staples`.
- Client/document knowledge in `pt_knowledge_*` and `pt_client_brain*`.
- Edit-learning/distillation functions such as `distill-coaching-learnings` and `distill-global-methodology`.
- Local Codex skills describe Pedro's intended workflow, but the live app depends on Edge Function prompts and database state.

For another trainer, the pipeline would need `trainer_id` passed through every generation run, retrieval call, prompt, exercise search, learning/distillation write, and programme/template lookup. Trainer philosophy should be data, not hardcoded prompt text.

## 6. CLIENT-FACING APP

Clients access the app at `/client-login` and `/client` using Supabase Auth. Login supports password, magic link, and reset password. The client app finds the client record through `pt_clients.user_id = auth.uid()`.

Current client capabilities include overview, journey/programme view, workout logging, nutrition onboarding/logging, bookings, settings/logout, messages, weekly tonnage, session counts, payments/top-ups, and AI-assisted client chat/check-ins. The link to the trainer is implicit because there is only one trainer environment. There is no visible trainer switch, organisation membership, or per-trainer client namespace.

## 7. KNOWN ISSUES & TECH DEBT

- Multi-trainer tenancy is not implemented.
- RLS is enabled but many policies are hardcoded to Pedro emails, broad authenticated access, or service-role-only flows.
- Several Edge Functions have `verify_jwt = false` and rely on internal secrets or in-function checks.
- Production secrets are spread across Vercel/Supabase envs and local `.env.local`.
- Some legacy Pedro emails still appear in policies/code.
- AI programme generation is complex and prompt-coupled; it works but is hard to reason about.
- Movement screening is incomplete beyond early pipeline stages.
- Studio recording remains browser-media fragile.
- Public/static media includes large committed video files.
- Social integrations are single-account and partially uneven by channel.
- Knowledge/RAG, methodology, programme staples, and AI learning are global, not trainer-scoped.

## 8. WHAT'S NOT BUILT

- Multi-trainer SaaS tenancy.
- Per-trainer roles, permissions, branding, billing, email, social, and calendar configuration.
- Per-trainer AI philosophy and prompt/runtime isolation.
- Full, proven AI self-improvement from every edit into future generation.
- Complete movement screening reporting/refinement workflow.
- Fully separated shared exercise library plus trainer-specific exercise overrides.
- Team/audit/admin controls beyond the current admin/client split.
- Mature environment/secret management documentation.
- A migration plan from Pedro-only production data to tenant-scoped data.
