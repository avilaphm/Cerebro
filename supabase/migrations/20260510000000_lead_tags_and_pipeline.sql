-- Cerebro lead pipeline: tag-based stage tracking.
-- Stage is computed from tags via lead_stage(). Adding new pipeline states
-- means seeding a new tag, not migrating columns.

-- Tag catalog ----------------------------------------------------------------

create table if not exists public.tags (
  slug         text primary key,
  label        text not null,
  description  text,
  color        text,                       -- hex without '#' for UI
  category     text not null,              -- 'lifecycle' | 'engagement' | 'outcome'
  sort_order   int  not null default 0,
  created_at   timestamptz not null default now()
);

-- Lead <-> Tag join (a lead can carry many tags simultaneously) -------------

create table if not exists public.lead_tags (
  lead_id     uuid references public.leads(id) on delete cascade,
  tag_slug    text references public.tags(slug) on delete cascade,
  created_at  timestamptz not null default now(),
  source      text not null default 'auto', -- 'auto' | 'manual' | 'webhook' | 'system'
  metadata    jsonb,
  primary key (lead_id, tag_slug)
);

create index if not exists lead_tags_lead_id_idx on public.lead_tags(lead_id);
create index if not exists lead_tags_tag_slug_idx on public.lead_tags(tag_slug);
create index if not exists lead_tags_created_at_idx on public.lead_tags(created_at desc);

-- Seed pipeline tags ---------------------------------------------------------

insert into public.tags (slug, label, description, category, sort_order, color) values
  ('chat_lead',            'Chat lead',            'Email captured from landing page chatbot',          'lifecycle',  10, 'a3a3a3'),
  ('email1_sent',          'Email 1 sent',         'Welcome / chat-summary email queued to lead',       'engagement', 20, 'd4d4d4'),
  ('email1_opened',        'Email 1 opened',       'Lead opened the welcome email',                     'engagement', 21, '94a3b8'),
  ('email2_sent',          'Email 2 sent',         'Proposal email queued to lead',                     'engagement', 30, 'd4d4d4'),
  ('email2_opened',        'Email 2 opened',       'Lead opened the proposal email',                    'engagement', 31, '94a3b8'),
  ('proposal_viewed',      'Proposal viewed',      'Lead opened the hosted proposal page',              'engagement', 40, '60a5fa'),
  ('proposal_downloaded',  'Proposal downloaded',  'Lead downloaded the proposal PDF',                  'engagement', 41, '3b82f6'),
  ('call_booked',          'Call booked',          'Lead picked a slot on the booking page',            'lifecycle',  50, '22c55e'),
  ('call_completed',       'Call completed',       'Discovery call has happened',                       'lifecycle',  51, '16a34a'),
  ('client',               'Client',               'Lead converted into a paying client',               'outcome',    60, '0f766e'),
  ('not_client',           'Not client',           'Call happened, lead did not convert',               'outcome',    61, 'f59e0b'),
  ('pre_call_nurture',     'Pre-call nurture',     'In nurture sequence before booking a call',         'lifecycle',  70, 'a78bfa'),
  ('post_call_nurture',    'Post-call nurture',    'In long-form nurture after a non-converting call',  'lifecycle',  71, 'a78bfa'),
  ('nurture_complete',     'Nurture complete',     'Final nurture email sent; long tail done',          'lifecycle',  80, '9ca3af'),
  ('lost',                 'Lost',                 'No engagement; manually or auto-marked dead',       'outcome',    90, 'ef4444')
on conflict (slug) do update set
  label       = excluded.label,
  description = excluded.description,
  category    = excluded.category,
  sort_order  = excluded.sort_order,
  color       = excluded.color;

-- Stage resolver -------------------------------------------------------------
-- One lead can carry many tags; this picks the single column the lead belongs in.
-- Highest precedence wins. Outcome tags (client/lost) always trump engagement.

create or replace function public.lead_stage(p_lead_id uuid)
returns text
language sql
stable
as $$
  with tags as (
    select tag_slug from public.lead_tags where lead_id = p_lead_id
  )
  select case
    when exists (select 1 from tags where tag_slug = 'client')                                      then 'client'
    when exists (select 1 from tags where tag_slug = 'lost')                                        then 'lost'
    when exists (select 1 from tags where tag_slug in ('not_client','post_call_nurture'))           then 'nurture'
    when exists (select 1 from tags where tag_slug in ('call_completed','call_booked'))             then 'call_booked'
    when exists (select 1 from tags where tag_slug = 'pre_call_nurture')                            then 'nurture'
    when exists (select 1 from tags where tag_slug in ('proposal_downloaded','proposal_viewed'))    then 'proposal_viewed'
    when exists (select 1 from tags where tag_slug in ('email2_opened','email2_sent'))              then 'email2_sent'
    when exists (select 1 from tags where tag_slug in ('email1_opened','email1_sent'))              then 'email1_sent'
    else 'fresh'
  end
$$;

-- Convenience view used by the dashboard ------------------------------------

create or replace view public.lead_stages as
  select
    l.id                       as lead_id,
    public.lead_stage(l.id)    as stage,
    coalesce(
      (select array_agg(tag_slug order by t.sort_order)
       from public.lead_tags lt
       join public.tags t on t.slug = lt.tag_slug
       where lt.lead_id = l.id),
      array[]::text[]
    )                          as tags
  from public.leads l;

-- RLS ------------------------------------------------------------------------

alter table public.tags enable row level security;
alter table public.lead_tags enable row level security;

create policy "service role full on tags"
  on public.tags for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "authenticated read tags"
  on public.tags for select
  using (auth.role() = 'authenticated');

create policy "service role full on lead_tags"
  on public.lead_tags for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "authenticated read lead_tags"
  on public.lead_tags for select
  using (auth.role() = 'authenticated');

create policy "authenticated insert lead_tags"
  on public.lead_tags for insert
  with check (auth.role() = 'authenticated');

create policy "authenticated delete lead_tags"
  on public.lead_tags for delete
  using (auth.role() = 'authenticated');

-- Backfill from legacy boolean columns --------------------------------------
-- Existing leads in production carry email_opened/call_booked/became_client
-- as booleans. Translate them so the new stage view returns the right column
-- without losing history. The booleans stay until a later migration drops them.

insert into public.lead_tags (lead_id, tag_slug, source)
  select id, 'chat_lead', 'system'
  from public.leads
  where email is not null
on conflict do nothing;

insert into public.lead_tags (lead_id, tag_slug, source)
  select lead_id, 'email2_sent', 'system'
  from public.proposals
  where sent_at is not null
on conflict do nothing;

insert into public.lead_tags (lead_id, tag_slug, source)
  select id, 'email2_opened', 'system'
  from public.leads
  where email_opened = true
on conflict do nothing;

insert into public.lead_tags (lead_id, tag_slug, source)
  select id, 'call_booked', 'system'
  from public.leads
  where call_booked = true
on conflict do nothing;

insert into public.lead_tags (lead_id, tag_slug, source)
  select id, 'client', 'system'
  from public.leads
  where became_client is true
on conflict do nothing;

insert into public.lead_tags (lead_id, tag_slug, source)
  select id, 'lost', 'system'
  from public.leads
  where became_client is false
on conflict do nothing;
