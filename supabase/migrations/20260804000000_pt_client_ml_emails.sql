-- "Email from M & L" - client-facing feedback emails generated from the PAR-Q,
-- the M & L assessment notes, and the generated M & L intelligence document.
--
-- Pedro picks the sources on the client card, types anything extra he wants
-- covered, generates the email, edits it, then sends it to the client. Every
-- generation is stored so the same email can be re-opened, re-edited, and the
-- send state stays auditable next to pt_notification_log.

create table if not exists public.pt_client_ml_emails (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.pt_clients(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Which evidence Pedro selected for this generation.
  source_parq_note_id uuid references public.pt_client_notes(id) on delete set null,
  source_note_ids uuid[] not null default '{}'::uuid[],
  source_document_ids uuid[] not null default '{}'::uuid[],

  -- Pedro's free-text box: extra things he wants in the email.
  coach_instructions text,

  subject text not null default '',
  body_markdown text not null default '',
  body_html text not null default '',

  status text not null default 'draft' check (status in ('draft', 'sent')),
  generation_mode text not null default 'ai' check (generation_mode in ('ai', 'fallback')),
  generation_error text,

  recipient_email text,
  sent_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists pt_client_ml_emails_client_created_idx
  on public.pt_client_ml_emails (client_id, created_at desc);

create index if not exists pt_client_ml_emails_parq_note_idx
  on public.pt_client_ml_emails (source_parq_note_id)
  where source_parq_note_id is not null;

create or replace function public.pt_client_ml_emails_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pt_client_ml_emails_set_updated_at on public.pt_client_ml_emails;
create trigger pt_client_ml_emails_set_updated_at
  before update on public.pt_client_ml_emails
  for each row execute function public.pt_client_ml_emails_touch_updated_at();

alter table public.pt_client_ml_emails enable row level security;

-- Coach-only surface. Clients receive the email itself, they never read the
-- drafts, the selected evidence, or Pedro's instructions.
create policy "service role full ml emails"
  on public.pt_client_ml_emails for all
  to service_role
  using (true) with check (true);

create policy "pt admins full ml emails"
  on public.pt_client_ml_emails for all
  to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) = any (array[
      'pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au', 'avila.phm@gmail.com'
    ])
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt() ->> 'email')) = any (array[
      'pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au', 'avila.phm@gmail.com'
    ])
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );
