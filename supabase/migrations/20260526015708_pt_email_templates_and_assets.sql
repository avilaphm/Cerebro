create table if not exists public.pt_email_templates (
  workflow_key text primary key,
  subject text not null default '',
  preview text not null default '',
  design jsonb not null default '{}'::jsonb,
  html text not null default '',
  status text not null default 'draft' check (status in ('draft', 'live')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null
);

alter table public.pt_email_templates enable row level security;

drop policy if exists "pt admins read email templates" on public.pt_email_templates;
drop policy if exists "pt admins write email templates" on public.pt_email_templates;

create policy "pt admins read email templates"
  on public.pt_email_templates
  for select
  to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au', 'avila.phm@gmail.com')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins write email templates"
  on public.pt_email_templates
  for all
  to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au', 'avila.phm@gmail.com')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au', 'avila.phm@gmail.com')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pt-email-assets',
  'pt-email-assets',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "pt admins upload email assets" on storage.objects;
drop policy if exists "pt admins update email assets" on storage.objects;
drop policy if exists "pt admins delete email assets" on storage.objects;

create policy "pt admins upload email assets"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'pt-email-assets'
    and (
      lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au', 'avila.phm@gmail.com')
      or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
    )
  );

create policy "pt admins update email assets"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'pt-email-assets'
    and (
      lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au', 'avila.phm@gmail.com')
      or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
    )
  )
  with check (
    bucket_id = 'pt-email-assets'
    and (
      lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au', 'avila.phm@gmail.com')
      or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
    )
  );

create policy "pt admins delete email assets"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'pt-email-assets'
    and (
      lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au', 'avila.phm@gmail.com')
      or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
    )
  );
