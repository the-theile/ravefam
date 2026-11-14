-- ===== HUDDLE GIFS =====
-- New huddle message kind 'gif'. A GIF is either from GIPHY search (proxied
-- through the giphy-proxy edge function so the API key never ships in
-- app.html) or from the curated RaveFAM pack (huddle_gif_pack, files in the
-- public 'huddle-gifs' Storage bucket).
--
-- Message shape (kind = 'gif'):
--   media_url   the looping clip: GIPHY .mp4 / .webp, or a pack file
--   media_meta  { "src": "giphy"|"pack", "id": "<giphy id | pack uuid>",
--                 "w": 200, "h": 150, "still": "<poster url>", "title": "…" }
--   body        always null -- GIF titles come from GIPHY, not the sender, so
--               they stay out of the content filter (and out of huddle search)
--
-- GIPHY's terms require hotlinking their CDN, so media_url is restricted to
-- GIPHY's media hosts or this project's huddle-gifs bucket. Any other URL
-- would let a sender make every crewmate's client fetch an arbitrary host.
--
-- Not applied by this change -- review and apply deliberately.

-- 'lineup' is listed so this stays a superset of whatever the live constraint
-- already allows (lineup rows are rendered by the app).
alter table public.huddle_messages drop constraint if exists huddle_messages_kind_check;
alter table public.huddle_messages add constraint huddle_messages_kind_check
  check (kind in ('text','photo','voice','meetup','beacon','system','lineup','gif'));

alter table public.huddle_messages
  add column if not exists media_meta jsonb null
  check (media_meta is null or jsonb_typeof(media_meta) = 'object');

alter table public.huddle_messages drop constraint if exists huddle_messages_gif_media_check;
alter table public.huddle_messages add constraint huddle_messages_gif_media_check
  check (kind <> 'gif' or (
    media_url ~ '^https://((media[0-9]?|i)\.giphy\.com|tvpgopciioqbqmjjjigh\.supabase\.co/storage/v1/object/public/huddle-gifs)/'
    and body is null
  ));

-- ── Curated RaveFAM pack ──
create table if not exists public.huddle_gif_pack (
  id          uuid        primary key default gen_random_uuid(),
  url         text        not null check (url ~ '^https://tvpgopciioqbqmjjjigh\.supabase\.co/storage/v1/object/public/huddle-gifs/'),
  still_url   text        null     check (still_url is null or still_url ~ '^https://tvpgopciioqbqmjjjigh\.supabase\.co/storage/v1/object/public/huddle-gifs/'),
  width       integer     not null check (width between 1 and 4000),
  height      integer     not null check (height between 1 and 4000),
  title       text        null     check (title is null or char_length(title) <= 80),
  tags        text[]      not null default '{}',
  sort        integer     not null default 0,
  active      boolean     not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid        default auth.uid() references auth.users(id) on delete set null
);

create index if not exists huddle_gif_pack_active_sort_idx on public.huddle_gif_pack (sort) where active;
create index if not exists huddle_gif_pack_tags_idx on public.huddle_gif_pack using gin (tags);

alter table public.huddle_gif_pack enable row level security;

drop policy if exists huddle_gif_pack_select on public.huddle_gif_pack;
create policy huddle_gif_pack_select on public.huddle_gif_pack for select to authenticated
  using (active or public.is_moderator(auth.uid()));

drop policy if exists huddle_gif_pack_write on public.huddle_gif_pack;
create policy huddle_gif_pack_write on public.huddle_gif_pack for all to authenticated
  using (public.is_moderator(auth.uid()))
  with check (public.is_moderator(auth.uid()));

-- Public bucket for pack files; only moderators upload.
insert into storage.buckets (id, name, public)
values ('huddle-gifs', 'huddle-gifs', true)
on conflict (id) do nothing;

drop policy if exists huddle_gifs_mod_write on storage.objects;
create policy huddle_gifs_mod_write on storage.objects for all to authenticated
  using (bucket_id = 'huddle-gifs' and public.is_moderator(auth.uid()))
  with check (bucket_id = 'huddle-gifs' and public.is_moderator(auth.uid()));

-- ── Per-user recents & favorites (synced across devices) ──
create table if not exists public.huddle_gif_favorites (
  user_id      uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  src          text        not null check (src in ('giphy','pack')),
  gif_id       text        not null check (char_length(gif_id) between 1 and 64),
  url          text        not null check (url ~ '^https://((media[0-9]?|i)\.giphy\.com|tvpgopciioqbqmjjjigh\.supabase\.co/storage/v1/object/public/huddle-gifs)/'),
  still_url    text        null,
  width        integer     not null check (width between 1 and 4000),
  height       integer     not null check (height between 1 and 4000),
  title        text        null check (title is null or char_length(title) <= 140),
  starred      boolean     not null default false,
  last_used_at timestamptz not null default now(),
  primary key (user_id, src, gif_id)
);

create index if not exists huddle_gif_favorites_recent_idx
  on public.huddle_gif_favorites (user_id, last_used_at desc);

alter table public.huddle_gif_favorites enable row level security;

drop policy if exists huddle_gif_favorites_own on public.huddle_gif_favorites;
create policy huddle_gif_favorites_own on public.huddle_gif_favorites for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
