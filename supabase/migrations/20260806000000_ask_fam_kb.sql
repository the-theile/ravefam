-- ===== ASK FAM: RAG KNOWLEDGE BASE =====
-- Backs the in-app "Ask FAM" help chatbot. kb_chunks holds embedded Help
-- Center content (see supabase/kb/articles.json, populated via the
-- kb-reindex edge function / scripts/reindex-kb.js — never edited directly
-- through the client). Public-readable: this is general help content only,
-- no crew/user data, so RLS just needs to block writes, not reads.

create extension if not exists vector;

create table if not exists public.kb_chunks (
  id text primary key,
  category text not null,
  source text not null default 'help_articles',
  title text not null,
  content_html text not null,
  keywords text[] not null default '{}',
  embedding vector(384),
  updated_at timestamptz not null default now()
);

create index if not exists kb_chunks_embedding_idx
  on public.kb_chunks using hnsw (embedding vector_cosine_ops);

alter table public.kb_chunks enable row level security;

drop policy if exists kb_chunks_public_read on public.kb_chunks;
create policy kb_chunks_public_read on public.kb_chunks
  for select to anon, authenticated using (true);

-- No insert/update/delete policy for anon/authenticated -- only the
-- kb-reindex edge function (service role, bypasses RLS) writes here.

create or replace function public.match_kb_chunks(
  query_embedding vector(384),
  match_count int default 5,
  match_threshold float default 0.3
)
returns table (
  id text, category text, title text, content_html text,
  similarity float
)
language sql stable
security definer
set search_path = public, pg_temp
as $$
  select id, category, title, content_html,
    1 - (embedding <=> query_embedding) as similarity
  from public.kb_chunks
  where 1 - (embedding <=> query_embedding) >= match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.match_kb_chunks(vector, int, float) to anon, authenticated;
