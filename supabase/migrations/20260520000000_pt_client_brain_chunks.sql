-- Client-scoped RAG: chunks each client's 4 brain docs (master, nutrition, exercise, lifestyle)
-- into pgvector-indexed rows so the client-analysis agent can semantically retrieve relevant context.

create extension if not exists vector with schema extensions;

create table if not exists public.pt_client_brain_chunks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.pt_clients(id) on delete cascade,
  doc_type text not null check (doc_type in ('master','nutrition','exercise','lifestyle')),
  chunk_index integer not null,
  chunk_text text not null,
  embedding extensions.vector(1536),
  source_columns text[] not null default '{}'::text[],
  created_at timestamptz not null default now()
);

create index if not exists pt_client_brain_chunks_client_idx
  on public.pt_client_brain_chunks (client_id, doc_type);

create index if not exists pt_client_brain_chunks_embedding_idx
  on public.pt_client_brain_chunks using ivfflat (embedding extensions.vector_cosine_ops) with (lists = 50);

alter table public.pt_client_brain_chunks enable row level security;

create policy "service role full client brain chunks"
  on public.pt_client_brain_chunks for all
  to service_role
  using (true)
  with check (true);

create policy "pt admins full client brain chunks"
  on public.pt_client_brain_chunks for all
  to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) = any (array['pedro@cerebroai.au', 'avila.phm@gmail.com'])
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt() ->> 'email')) = any (array['pedro@cerebroai.au', 'avila.phm@gmail.com'])
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create or replace function public.match_client_brain_chunks(
  query_embedding extensions.vector,
  target_client_id uuid,
  match_count integer default 8,
  match_threshold double precision default 0.25
)
returns table (
  id uuid,
  client_id uuid,
  doc_type text,
  chunk_index integer,
  chunk_text text,
  similarity double precision
)
language sql stable security definer set search_path = 'public', 'extensions' as $$
  select
    c.id,
    c.client_id,
    c.doc_type,
    c.chunk_index,
    c.chunk_text,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.pt_client_brain_chunks c
  where c.client_id = target_client_id
    and c.embedding is not null
    and 1 - (c.embedding <=> query_embedding) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.match_client_brain_chunks(extensions.vector, uuid, integer, double precision) to authenticated, service_role;
