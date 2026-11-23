-- ===== RAVE WIRE (phase 1, step 1) =====
-- The Wire: a ticker on every tab plus a Fam HQ pin on Crews. Every item
-- lives in wire_items; the app never touches that table directly.
--   reads   -> wire_feed()            (security definer, filters crew items)
--   writes  -> wire_post() / wire_hide() (super admins only)
--   reacts  -> wire_reactions         (own rows, RLS)
--   seen    -> wire_seen              (pin dismissals, New items shown once)
-- Crew / lineup triggers and the daily pulse job come in a later migration.
--
-- Deliberately free of delete/drop/truncate (including function bodies) so
-- it can go through apply_migration. Old rows are filtered by expires_at,
-- never deleted here; hiding is a soft hidden_at.

-- ----- tables -----
create table if not exists public.wire_items (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('crew','lineup','pulse','hq','new','meme')),
  crew_id        uuid references public.crews(id) on delete cascade,
  festival_id    uuid references public.festivals(id) on delete set null,
  artist_id      bigint references public.artists(id) on delete set null,
  actor_user_id  uuid references auth.users(id) on delete set null,  -- who a crew item names; used for blocks
  title          text not null check (char_length(title) between 1 and 90),
  body           text check (body is null or char_length(body) <= 600),
  link_url       text check (link_url is null or link_url ~* '^https?://'),
  link_preview   jsonb,
  deep_link      jsonb,                         -- e.g. {"tab":"events","festival_id":"..."}
  cta_label      text check (cta_label is null or char_length(cta_label) <= 30),
  meta           jsonb not null default '{}'::jsonb,  -- per-kind extras (meme lines, pulse stat)
  app_version    text,                          -- New items: the APP_VERSION they shipped in
  pinned_until   timestamptz,                   -- Fam HQ pin on Crews; one live at a time
  push_sent_at   timestamptz,                   -- set when a Fam HQ push is reserved
  starts_at      timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '7 days',
  dedupe_key     text unique,                   -- triggers upsert on this
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  hidden_at      timestamptz,
  constraint wire_items_crew_scope check (kind <> 'crew' or crew_id is not null)
);

create index if not exists wire_items_live_idx  on public.wire_items (expires_at desc) where hidden_at is null;
create index if not exists wire_items_crew_idx  on public.wire_items (crew_id) where crew_id is not null;
create index if not exists wire_items_pin_idx   on public.wire_items (pinned_until) where pinned_until is not null;
create index if not exists wire_items_push_idx  on public.wire_items (push_sent_at) where push_sent_at is not null;

create table if not exists public.wire_reactions (
  item_id    uuid not null references public.wire_items(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  emoji      text not null check (emoji in ('fire','heart','melt','hands')),
  created_at timestamptz not null default now(),
  primary key (item_id, user_id, emoji)
);
create index if not exists wire_reactions_user_idx on public.wire_reactions (user_id);

create table if not exists public.wire_seen (
  item_id      uuid not null references public.wire_items(id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  seen_at      timestamptz not null default now(),
  dismissed_at timestamptz,
  primary key (item_id, user_id)
);
create index if not exists wire_seen_user_idx on public.wire_seen (user_id);

-- ----- visibility helper (used by RLS and wire_feed) -----
-- Same membership rule as game_plans: crew leader or a claimed member.
create or replace function public.wire_item_visible(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.wire_items w
    where w.id = p_item_id
      and w.hidden_at is null
      and w.starts_at <= now()
      and w.expires_at > now()
      and (
        w.crew_id is null
        or exists (select 1 from public.crews c
                   where c.id = w.crew_id and c.deleted_at is null and c.leader_id = auth.uid())
        or public.user_is_claimed_member_of_crew(w.crew_id)
      )
      and not exists (select 1 from public.user_blocks b
                      where b.blocker_id = auth.uid() and b.blocked_id = w.actor_user_id)
  );
$$;

-- ----- RLS -----
alter table public.wire_items     enable row level security;
alter table public.wire_reactions enable row level security;
alter table public.wire_seen      enable row level security;
-- wire_items: no policies on purpose; only security definer RPCs and service_role touch it.

create policy wire_reactions_select on public.wire_reactions
  for select to authenticated using (user_id = (select auth.uid()));
create policy wire_reactions_insert on public.wire_reactions
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.wire_item_visible(item_id));
create policy wire_reactions_delete on public.wire_reactions
  for delete to authenticated using (user_id = (select auth.uid()));

create policy wire_seen_select on public.wire_seen
  for select to authenticated using (user_id = (select auth.uid()));
create policy wire_seen_insert on public.wire_seen
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.wire_item_visible(item_id));
create policy wire_seen_update on public.wire_seen
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ----- grants (no auto-grants since Oct 30 2026) -----
revoke all on public.wire_items from anon, authenticated;
grant select, insert, update, delete on public.wire_items to service_role;

revoke all on public.wire_reactions from anon;
grant select, insert, delete on public.wire_reactions to authenticated;
grant select, insert, update, delete on public.wire_reactions to service_role;

revoke all on public.wire_seen from anon;
grant select, insert, update on public.wire_seen to authenticated;
grant select, insert, update, delete on public.wire_seen to service_role;

-- ----- wire_feed: everything the caller may see, with reactions -----
create or replace function public.wire_feed(p_limit integer default 60)
returns table (
  id uuid, kind text, crew_id uuid, festival_id uuid, artist_id bigint,
  title text, body text, link_url text, link_preview jsonb, deep_link jsonb,
  cta_label text, meta jsonb, app_version text, pinned_until timestamptz,
  created_at timestamptz, updated_at timestamptz,
  reactions jsonb, my_reactions text[], seen boolean, dismissed boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select w.id, w.kind, w.crew_id, w.festival_id, w.artist_id,
         w.title, w.body, w.link_url, w.link_preview, w.deep_link,
         w.cta_label, w.meta, w.app_version,
         case when w.pinned_until > now() then w.pinned_until end,
         w.created_at, w.updated_at,
         coalesce((select jsonb_object_agg(r.emoji, r.n)
                   from (select emoji, count(*) n from public.wire_reactions
                         where item_id = w.id group by emoji) r), '{}'::jsonb),
         coalesce((select array_agg(emoji order by emoji) from public.wire_reactions
                   where item_id = w.id and user_id = auth.uid()), '{}'::text[]),
         s.item_id is not null,
         s.dismissed_at is not null
  from public.wire_items w
  left join public.wire_seen s on s.item_id = w.id and s.user_id = auth.uid()
  where auth.uid() is not null
    and public.wire_item_visible(w.id)
  order by (w.crew_id is not null) desc, w.updated_at desc
  limit least(greatest(coalesce(p_limit, 60), 1), 200);
$$;

-- ----- wire_push_available_at: when the weekly push slot frees up -----
create or replace function public.wire_push_available_at()
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when public.is_super_admin() then
    coalesce((select max(push_sent_at) + interval '7 days' from public.wire_items
              where push_sent_at > now() - interval '7 days'), now())
  end;
$$;

-- ----- wire_post: Fam HQ composer (super admins only) -----
create or replace function public.wire_post(
  p_kind         text,
  p_title        text,
  p_body         text    default null,
  p_link_url     text    default null,
  p_link_preview jsonb   default null,
  p_deep_link    jsonb   default null,
  p_cta_label    text    default null,
  p_meta         jsonb   default '{}'::jsonb,
  p_app_version  text    default null,
  p_pin_days     integer default 0,
  p_expires_days integer default 7,
  p_push         boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id   uuid;
  v_next timestamptz;
begin
  if not public.is_super_admin() then
    raise exception 'wire_post: super admins only' using errcode = '42501';
  end if;
  if p_kind not in ('hq','new','meme') then
    raise exception 'wire_post: kind must be hq, new or meme';
  end if;
  if coalesce(p_pin_days, 0) not in (0, 1, 3, 7) then
    raise exception 'wire_post: pin must be 0, 1, 3 or 7 days';
  end if;
  if coalesce(p_expires_days, 7) not between 1 and 60 then
    raise exception 'wire_post: expiry must be 1 to 60 days';
  end if;

  if p_push then
    select max(push_sent_at) + interval '7 days' into v_next
    from public.wire_items where push_sent_at > now() - interval '7 days';
    if v_next is not null then
      raise exception 'wire_push_weekly_limit'
        using detail = to_char(v_next at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
              hint = 'One Wire push per 7 days.';
    end if;
  end if;

  -- One live pin at a time: a new pin ends the old one.
  if coalesce(p_pin_days, 0) > 0 then
    update public.wire_items set pinned_until = null, updated_at = now()
    where pinned_until > now();
  end if;

  insert into public.wire_items (
    kind, title, body, link_url, link_preview, deep_link, cta_label, meta,
    app_version, pinned_until, push_sent_at, expires_at, created_by
  ) values (
    p_kind, btrim(p_title), nullif(btrim(p_body), ''), nullif(btrim(p_link_url), ''),
    p_link_preview, p_deep_link, nullif(btrim(p_cta_label), ''), coalesce(p_meta, '{}'::jsonb),
    nullif(btrim(p_app_version), ''),
    case when coalesce(p_pin_days, 0) > 0 then now() + make_interval(days => p_pin_days) end,
    case when p_push then now() end,
    now() + make_interval(days => greatest(coalesce(p_expires_days, 7), coalesce(p_pin_days, 0))),
    auth.uid()
  ) returning id into v_id;

  return v_id;
end;
$$;

-- ----- wire_hide: soft-remove any item (super admins only) -----
create or replace function public.wire_hide(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_super_admin() then
    raise exception 'wire_hide: super admins only' using errcode = '42501';
  end if;
  update public.wire_items
     set hidden_at = now(), pinned_until = null, updated_at = now()
   where id = p_id;
end;
$$;

-- ----- function grants -----
revoke all on function public.wire_item_visible(uuid) from public;
revoke all on function public.wire_feed(integer) from public;
revoke all on function public.wire_push_available_at() from public;
revoke all on function public.wire_post(text, text, text, text, jsonb, jsonb, text, jsonb, text, integer, integer, boolean) from public;
revoke all on function public.wire_hide(uuid) from public;

grant execute on function public.wire_item_visible(uuid) to authenticated, service_role;
grant execute on function public.wire_feed(integer) to authenticated, service_role;
grant execute on function public.wire_push_available_at() to authenticated, service_role;
grant execute on function public.wire_post(text, text, text, text, jsonb, jsonb, text, jsonb, text, integer, integer, boolean) to authenticated, service_role;
grant execute on function public.wire_hide(uuid) to authenticated, service_role;
