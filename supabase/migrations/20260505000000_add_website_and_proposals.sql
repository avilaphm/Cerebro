-- Add website column to leads (lead can optionally share their site URL during the chat)
alter table public.leads add column if not exists website text;

-- Proposals table: stores the bespoke storytelling proposal generated for each lead
-- after the chat is captured. Includes the research summary used to personalize it,
-- and a separate set of discovery questions for Pedro to ask on the call.
create table if not exists public.proposals (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  lead_id             uuid references public.leads(id) on delete cascade,
  proposal_html       text,
  proposal_text       text,
  research_summary    text,
  discovery_questions text,
  sent_at             timestamptz,
  status              text default 'pending'  -- pending | sent | failed
);

create index if not exists proposals_lead_id_idx on public.proposals(lead_id);

alter table public.proposals enable row level security;

create policy "service role only on proposals"
  on public.proposals for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
