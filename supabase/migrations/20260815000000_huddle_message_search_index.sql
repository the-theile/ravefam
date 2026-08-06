-- Huddle search: the client looks for a message by substring
-- (`body ilike '%term%'`), scoped to one room, one crew, or every crew the
-- viewer can see. Without an index that is a sequential scan of the crew's
-- whole message history on every keystroke's debounced query.
--
-- A trigram GIN index is the one index type Postgres can use for a leading-
-- wildcard ILIKE, so it covers exactly the shape of query the feature issues.
-- Sender/room/crew filters still ride the existing
-- huddle_messages_room_created_idx / huddle_messages_crew_idx.
create extension if not exists pg_trgm;

create index if not exists huddle_messages_body_trgm_idx
  on public.huddle_messages using gin (body gin_trgm_ops)
  where deleted_at is null;
