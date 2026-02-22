create or replace function match_embeddings(
  query_embedding vector(1536),
  match_threshold float default 0.78,
  match_count int default 10,
  p_owner_id uuid default null
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    e.id,
    e.content,
    e.metadata,
    1 - (e.embedding <=> query_embedding) as similarity
  from public.embeddings e
  where
    (p_owner_id is null or e.owner_id = p_owner_id)
    and 1 - (e.embedding <=> query_embedding) > match_threshold
  order by e.embedding <=> query_embedding
  limit match_count;
end;
$$;