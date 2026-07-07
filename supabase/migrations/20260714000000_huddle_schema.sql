-- Crew Huddle: real-time crew chat (Main room + one room per shared upcoming
-- festival + optional leader-created custom rooms).
--
-- Rooms are materialized lazily: the client derives which "virtual" rooms
-- *could* exist (Main always; one per festival the crew's members are
-- jointly attending, computed the same way crewNextUp() aggregates each
-- member's individual raver_festivals RSVPs) and only inserts a huddle_rooms
-- row the first time someone actually opens one (on conflict do nothing, so
-- two members opening simultaneously don't race into duplicate rooms).
create table public.huddle_rooms (
  id          uuid primary key default gen_random_uuid(),
  crew_id     uuid not null references public.crews(id) on delete cascade,
  room_key    text not null,          -- 'main' | 'festival:<festival_id>' | 'custom:<uuid>'
  kind        text not null default 'main' check (kind in ('main','festival','custom')),
  name        text not null,
  festival_id uuid null references public.festivals(id) on delete set null,
  created_by  uuid null references auth.users(id),
  created_at  timestamptz not null default now(),
  unique (crew_id, room_key)
);

alter table public.huddle_rooms enable row level security;

create index huddle_rooms_crew_idx on public.huddle_rooms (crew_id);

-- Messages: text, photo, voice note, meetup-pin, and the special "beacon"
-- urgent-message type — one flat table with nullable type-specific columns,
-- matching how crew_jams/dream_board_pins already do this rather than
-- normalizing into per-type tables.
create table public.huddle_messages (
  id                uuid primary key default gen_random_uuid(),
  room_id           uuid not null references public.huddle_rooms(id) on delete cascade,
  crew_id           uuid not null references public.crews(id) on delete cascade, -- denormalized for cheap RLS + realtime filter without a join
  sender_id         uuid not null references auth.users(id),
  kind              text not null default 'text' check (kind in ('text','photo','voice','meetup','beacon')),
  body              text null,                 -- text body / meetup place-name+note / beacon message
  media_url         text null,                 -- photo or voice note storage URL
  media_duration_ms integer null,               -- voice note duration, for the player UI
  meetup_at         timestamptz null,           -- optional meetup time (meetup kind only)
  reactions         jsonb not null default '{}'::jsonb, -- { "🕊️": ["<uid>", ...], ... } — same shape as crew_jams.reactions
  expires_at        timestamptz null,           -- beacon only: created_at + 2h, computed at insert time
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz null,
  deleted_by        uuid null references auth.users(id)
);

alter table public.huddle_messages enable row level security;

create index huddle_messages_room_created_idx on public.huddle_messages (room_id, created_at);
create index huddle_messages_crew_idx on public.huddle_messages (crew_id);
-- Fast lookup of the currently-active beacon per crew (partial index — beacons are rare and short-lived).
create index huddle_messages_active_beacon_idx on public.huddle_messages (crew_id, expires_at)
  where kind = 'beacon' and deleted_at is null;

-- ── RLS: huddle_rooms ──
-- Membership check reuses public.user_is_claimed_member_of_crew(p_crew_id)
-- verbatim (existing SECURITY DEFINER STABLE helper, already used across the
-- app's crew-scoped RLS policies).
create policy huddle_rooms_select on public.huddle_rooms for select to authenticated
  using (
    exists (select 1 from public.crews c where c.id = huddle_rooms.crew_id and c.leader_id = auth.uid())
    or public.user_is_claimed_member_of_crew(crew_id)
    or public.is_moderator(auth.uid())
  );

create policy huddle_rooms_insert on public.huddle_rooms for insert to authenticated
  with check (
    (
      exists (select 1 from public.crews c where c.id = huddle_rooms.crew_id and c.leader_id = auth.uid())
      or public.user_is_claimed_member_of_crew(crew_id)
    )
    and (
      -- main/festival rooms: any crew member can lazily materialize
      kind in ('main','festival')
      -- custom rooms: crew lead (or moderator) only
      or (kind = 'custom' and (
        exists (select 1 from public.crews c where c.id = huddle_rooms.crew_id and c.leader_id = auth.uid())
        or public.is_moderator(auth.uid())
      ))
    )
  );

-- ── RLS: huddle_messages ──
create policy huddle_messages_select on public.huddle_messages for select to authenticated
  using (
    exists (select 1 from public.crews c where c.id = huddle_messages.crew_id and c.leader_id = auth.uid())
    or public.user_is_claimed_member_of_crew(crew_id)
    or public.is_moderator(auth.uid())
  );

create policy huddle_messages_insert on public.huddle_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and (
      exists (select 1 from public.crews c where c.id = huddle_messages.crew_id and c.leader_id = auth.uid())
      or public.user_is_claimed_member_of_crew(crew_id)
    )
  );

-- Reactions are implemented as an UPDATE of the `reactions` jsonb column by
-- ANY crew member (not just the sender) — same posture as crew_jams
-- reactions. Soft-delete-your-own-message is also an UPDATE (deleted_at),
-- gated to sender/crew-lead/moderator by the trigger below.
create policy huddle_messages_update on public.huddle_messages for update to authenticated
  using (
    exists (select 1 from public.crews c where c.id = huddle_messages.crew_id and c.leader_id = auth.uid())
    or public.user_is_claimed_member_of_crew(crew_id)
    or public.is_moderator(auth.uid())
  )
  with check (
    exists (select 1 from public.crews c where c.id = huddle_messages.crew_id and c.leader_id = auth.uid())
    or public.user_is_claimed_member_of_crew(crew_id)
    or public.is_moderator(auth.uid())
  );

-- Soft-delete-your-own-message guard: only the sender, the crew lead, or a
-- moderator may transition deleted_at null -> not-null. Reactions (any other
-- column change, e.g. the `reactions` jsonb) pass through untouched.
create or replace function public.enforce_huddle_message_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_is_lead boolean;
begin
  if OLD.deleted_at is not distinct from NEW.deleted_at then
    return NEW;
  end if;
  if public.is_moderator(v_uid) then
    return NEW;
  end if;
  if NEW.deleted_at is not null and OLD.sender_id = v_uid then
    return NEW;
  end if;
  select exists (select 1 from public.crews where id = OLD.crew_id and leader_id = v_uid) into v_is_lead;
  if NEW.deleted_at is not null and v_is_lead then
    return NEW;
  end if;
  raise exception 'FORBIDDEN: only the sender, crew lead, or a moderator can delete this message.';
end;
$$;

create trigger huddle_messages_soft_delete before update on public.huddle_messages
  for each row execute function public.enforce_huddle_message_soft_delete();

-- Fold into the existing destructive-action rate limiter for consistency with
-- every other soft-deletable content type in the app.
create trigger huddle_messages_rate_limit before update on public.huddle_messages
  for each row execute function public.enforce_destructive_action_rate_limit();

-- Extend flags so Huddle messages are reportable, matching every other
-- content type's moderation path.
alter table public.flags drop constraint if exists flags_target_type_check;
alter table public.flags add constraint flags_target_type_check
  check (target_type in ('raver','festival','crew','crew_member','vibe_tag','photo','dream_pin','archive_link','poll','jam','huddle_message'));

-- Realtime: the app's other "live" tables (crew_members/crews/raver_festivals/
-- notifications) were found to NOT be registered in the supabase_realtime
-- publication (verified live: puballtables=false, 0 tables present) — so
-- their postgres_changes listeners are currently silent no-ops. Do not repeat
-- that mistake here: explicitly register huddle_messages.
alter publication supabase_realtime add table public.huddle_messages;

-- ── Storage: huddle-media bucket ──
-- Separate from `photos` (which is mime-restricted to image formats at the
-- bucket-config level and would reject voice-note audio outright) so chat
-- ephemera has its own bucket/lifecycle, distinct from profile/crew photos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('huddle-media', 'huddle-media', true, 10485760, array[
  'image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif',
  'audio/webm','audio/mp4','audio/mpeg','audio/ogg','audio/wav'
]);

-- Mirrors the existing `photos_*` bucket policy posture exactly (bucket-scoped
-- only, no per-path/owner enforcement — a pre-existing convention across all
-- buckets in this app, not something introduced here).
create policy huddle_media_public_read on storage.objects for select
  using (bucket_id = 'huddle-media');
create policy huddle_media_auth_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'huddle-media');
create policy huddle_media_auth_update on storage.objects for update to authenticated
  using (bucket_id = 'huddle-media');
create policy huddle_media_auth_delete on storage.objects for delete to authenticated
  using (bucket_id = 'huddle-media');
