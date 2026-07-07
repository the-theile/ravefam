-- Festival map + tap-to-place Huddle meetup pins: admins/moderators can
-- upload a static map image per festival; when one exists, crew members can
-- optionally tap a point on it when dropping a meetup pin instead of relying
-- on on-site GPS (unreliable at festivals). Pin coordinates are normalized
-- (0-1) relative to the map image and tied to the meetup message's own
-- lifecycle -- they expire/delete along with the message, same as the
-- existing text+timestamp pin behavior.

alter table public.festivals
  add column if not exists map_url text,
  add column if not exists map_uploaded_by uuid references auth.users(id),
  add column if not exists map_uploaded_at timestamptz;

alter table public.huddle_messages
  add column if not exists pin_x numeric check (pin_x is null or (pin_x between 0 and 1)),
  add column if not exists pin_y numeric check (pin_y is null or (pin_y between 0 and 1));

-- Column-scoped guard: general festival UPDATE rights (e.g. the creator, per
-- festivalPerms().canEdit client-side) must not be able to touch the map
-- columns outside the moderator-gated upload flow -- same technique as
-- enforce_privacy_toggle_writes (20260709000001), which blocks specific
-- column changes via a before-update trigger while leaving the rest of the
-- row updatable.
create or replace function public.enforce_festival_map_moderator_only()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (NEW.map_url is distinct from OLD.map_url
      or NEW.map_uploaded_by is distinct from OLD.map_uploaded_by)
     and not public.is_moderator(auth.uid()) then
    raise exception 'Only moderators can update the festival map';
  end if;
  return NEW;
end;
$$;

create trigger festivals_enforce_map_moderator_only
  before update on public.festivals
  for each row execute function public.enforce_festival_map_moderator_only();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('festival-maps', 'festival-maps', true, 10485760, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy festival_maps_read on storage.objects for select
  using (bucket_id = 'festival-maps');
create policy festival_maps_write on storage.objects for insert to authenticated
  with check (bucket_id = 'festival-maps' and is_moderator(auth.uid()));
create policy festival_maps_update on storage.objects for update to authenticated
  using (bucket_id = 'festival-maps' and is_moderator(auth.uid()))
  with check (bucket_id = 'festival-maps' and is_moderator(auth.uid()));
create policy festival_maps_delete on storage.objects for delete to authenticated
  using (bucket_id = 'festival-maps' and is_moderator(auth.uid()));
