-- Enable pgvector extension for embeddings
create extension if not exists vector with schema extensions;

-- Knowledge documents table (one row per uploaded file or web source)
create table if not exists public.pt_knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  file_path text,
  file_type text,
  source text not null default 'upload',
  content_text text,
  chunk_count int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.pt_knowledge_documents enable row level security;

create policy "PT admin full access on knowledge docs"
  on public.pt_knowledge_documents for all
  using (auth.email() = 'avila.phm@gmail.com');

-- Knowledge chunks with embeddings (one row per text chunk)
create table if not exists public.pt_knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.pt_knowledge_documents(id) on delete cascade,
  chunk_index int not null,
  chunk_text text not null,
  embedding extensions.vector(1536),
  created_at timestamptz not null default now()
);

alter table public.pt_knowledge_chunks enable row level security;

create policy "PT admin full access on knowledge chunks"
  on public.pt_knowledge_chunks for all
  using (auth.email() = 'avila.phm@gmail.com');

-- IVFFlat index for fast cosine similarity search
create index if not exists pt_knowledge_chunks_embedding_idx
  on public.pt_knowledge_chunks
  using ivfflat (embedding extensions.vector_cosine_ops)
  with (lists = 50);

-- RPC for semantic similarity search used by generation edge functions
create or replace function match_knowledge_chunks(
  query_embedding extensions.vector(1536),
  match_count int default 6,
  match_threshold float default 0.4
)
returns table (
  chunk_text text,
  document_title text,
  similarity float
)
language sql stable security definer
as $$
  select
    c.chunk_text,
    d.title as document_title,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.pt_knowledge_chunks c
  join public.pt_knowledge_documents d on d.id = c.document_id
  where c.embedding is not null
    and 1 - (c.embedding <=> query_embedding) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
