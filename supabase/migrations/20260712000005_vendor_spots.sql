-- Vendor Village "spotted right now" live check-ins (Feature 3): a raver
-- pings that they see a vendor set up at a festival right now. Full
-- soft-delete + rate-limit posture, same weight as vendor_reviews — a fake
-- or harassing "spotted" caption is still abuse, and reusing the generic
-- softDeleteRow/logAudit/flags/Mod-Dashboard machinery is less code than a
-- bespoke lighter deletion path just for this table.
--
-- "Currently spotted" (~24h relevance) is a pure render-time filter on
-- created_at — no TTL column, no cron job.
create table public.vendor_spots (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid not null references public.vendors(id) on delete cascade,
  festival_id   uuid not null references public.festivals(id) on delete cascade,
  spotted_by    uuid not null references auth.users(id) on delete cascade,
  caption       text check (caption is null or char_length(caption) <= 140),
  deleted_at    timestamptz,
  deleted_by    uuid references auth.users(id),
  delete_reason text,
  created_at    timestamptz not null default now()
);

alter table public.vendor_spots enable row level security;

create index vendor_spots_vendor_idx   on public.vendor_spots (vendor_id, created_at desc) where deleted_at is null;
create index vendor_spots_festival_idx on public.vendor_spots (festival_id, created_at desc) where deleted_at is null;
create index vendor_spots_spotter_idx  on public.vendor_spots (spotted_by, created_at desc) where deleted_at is null;

create policy vendor_spots_select on public.vendor_spots for select
  using (deleted_at is null or is_moderator(auth.uid()));

create policy vendor_spots_insert on public.vendor_spots for insert to authenticated
  with check (spotted_by = auth.uid());

create policy vendor_spots_update on public.vendor_spots for update to authenticated
  using (spotted_by = auth.uid() or is_moderator(auth.uid()))
  with check (spotted_by = auth.uid() or is_moderator(auth.uid()));

-- Soft-delete/restore gating, same shape as enforce_vendor_review_soft_delete.
create or replace function public.enforce_vendor_spot_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if OLD.deleted_at is not distinct from NEW.deleted_at then
    return NEW;
  end if;
  if public.is_moderator(v_uid) then
    return NEW;
  end if;
  if NEW.deleted_at is not null and OLD.spotted_by = v_uid then
    return NEW;
  end if;
  raise exception 'FORBIDDEN: only the spotter (to delete) or a moderator (to delete/restore) can do this.';
end;
$$;

drop trigger if exists vendor_spots_soft_delete on public.vendor_spots;
create trigger vendor_spots_soft_delete before update on public.vendor_spots
  for each row execute function public.enforce_vendor_spot_soft_delete();

drop trigger if exists vendor_spots_rate_limit on public.vendor_spots;
create trigger vendor_spots_rate_limit before update on public.vendor_spots
  for each row execute function public.enforce_destructive_action_rate_limit();
