-- ===== CONTENT FILTER: blocked terms on user text =====
-- App Store guideline 1.2 asks apps with user-generated content for "a method
-- for filtering objectionable material from being posted", on top of reports
-- and blocking. This rejects inserts/updates whose user-visible text contains a
-- term from moderation_blocked_terms, matched as a whole word (case-insensitive,
-- plus a simple leetspeak pass: 0→o 1→i 3→e 4→a 5→s 7→t @→a $→s).
--
-- Covered text (what other ravers see):
--   huddle_messages.body · ravers.name/handle/notes · crews.name/description
--   vendor_reviews.body · venue_reviews.body
-- On UPDATE only columns that changed are checked, so old rows never block
-- unrelated edits (a gradient change, a moderator action).
--
-- Rejections raise 'content_not_allowed' (SQLSTATE P0001, DETAIL = column);
-- app.html's isContentBlocked() turns that into a friendly toast.
--
-- Moderators manage the list:
--   insert into public.moderation_blocked_terms (term) values ('someword');
-- Terms are lowercase letters/digits, single spaces allowed ("two words").
--
-- Not applied by this change -- review and apply deliberately.

create table if not exists public.moderation_blocked_terms (
  term        text        primary key,
  created_at  timestamptz not null default now(),
  created_by  uuid        default auth.uid() references auth.users(id) on delete set null,
  constraint moderation_blocked_terms_shape check (term ~ '^[a-z0-9]+( [a-z0-9]+)*$')
);

alter table public.moderation_blocked_terms enable row level security;

drop policy if exists moderation_blocked_terms_mod_all on public.moderation_blocked_terms;
create policy moderation_blocked_terms_mod_all on public.moderation_blocked_terms
  for all to authenticated
  using (public.is_moderator(auth.uid()))
  with check (public.is_moderator(auth.uid()));

-- True when p_text contains a blocked term as a whole word.
create or replace function public.text_has_blocked_term(p_text text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_text is not null and exists (
    select 1
    from public.moderation_blocked_terms t,
         (select lower(p_text) as plain,
                 translate(lower(p_text), '013457@$', 'oieastas') as leet) s
    where s.plain ~ ('\m' || t.term || '\M')
       or s.leet  ~ ('\m' || t.term || '\M')
  );
$$;

revoke all on function public.text_has_blocked_term(text) from public;
grant execute on function public.text_has_blocked_term(text) to authenticated;

-- Trigger body: TG_ARGV lists the text columns to check.
create or replace function public.reject_blocked_terms()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  col   text;
  v_new text;
begin
  foreach col in array TG_ARGV loop
    v_new := to_jsonb(NEW) ->> col;
    continue when v_new is null;
    continue when TG_OP = 'UPDATE' and v_new is not distinct from (to_jsonb(OLD) ->> col);
    if public.text_has_blocked_term(v_new) then
      raise exception 'content_not_allowed' using errcode = 'P0001', detail = col;
    end if;
  end loop;
  return NEW;
end;
$$;

drop trigger if exists huddle_messages_content_filter on public.huddle_messages;
create trigger huddle_messages_content_filter
  before insert or update on public.huddle_messages
  for each row execute function public.reject_blocked_terms('body');

drop trigger if exists ravers_content_filter on public.ravers;
create trigger ravers_content_filter
  before insert or update on public.ravers
  for each row execute function public.reject_blocked_terms('name', 'handle', 'notes');

drop trigger if exists crews_content_filter on public.crews;
create trigger crews_content_filter
  before insert or update on public.crews
  for each row execute function public.reject_blocked_terms('name', 'description');

drop trigger if exists vendor_reviews_content_filter on public.vendor_reviews;
create trigger vendor_reviews_content_filter
  before insert or update on public.vendor_reviews
  for each row execute function public.reject_blocked_terms('body');

drop trigger if exists venue_reviews_content_filter on public.venue_reviews;
create trigger venue_reviews_content_filter
  before insert or update on public.venue_reviews
  for each row execute function public.reject_blocked_terms('body');

-- Starter list: slurs that are never acceptable here. Moderators add more
-- (variants, new spam phrases) as reports come in.
insert into public.moderation_blocked_terms (term, created_by) values
  ('nigger', null), ('niggers', null), ('nigga', null), ('niggas', null),
  ('faggot', null), ('faggots', null), ('fag', null), ('fags', null),
  ('kike', null), ('kikes', null), ('spic', null), ('spics', null),
  ('chink', null), ('chinks', null), ('gook', null), ('gooks', null),
  ('wetback', null), ('wetbacks', null), ('beaner', null), ('beaners', null),
  ('raghead', null), ('ragheads', null), ('towelhead', null), ('towelheads', null),
  ('tranny', null), ('trannies', null), ('retard', null), ('retards', null)
on conflict (term) do nothing;
