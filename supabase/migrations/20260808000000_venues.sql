-- ===== VENUE DIRECTORY: venues, rave link, reviews =====
-- A community venue directory living in the Village section alongside the
-- vendor directory. Any raver can post a venue (a club, warehouse, festival
-- grounds) and it goes live immediately — same open-posting posture as
-- vendors, moderated after the fact via the existing flags/report system.
-- A rave can optionally link to a single venue (festivals.venue_id); venue
-- reviews are open to any raver, not gated on having attended a rave there,
-- matching vendor_reviews' posture.
create table public.venues (
  id               uuid primary key default gen_random_uuid(),
  created_by       uuid not null references auth.users(id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 1 and 80),
  description      text check (description is null or char_length(description) <= 600),
  website_url      text check (website_url is null or website_url ~* '^https?://'),
  instagram        text,
  cover_photo_url  text,
  location         text,
  lat              double precision,
  lng              double precision,
  deleted_at       timestamptz,
  deleted_by       uuid references auth.users(id),
  delete_reason    text,
  created_at       timestamptz not null default now()
);

alter table public.venues enable row level security;

create index venues_active_idx on public.venues (deleted_at) where deleted_at is null;

create policy venues_select on public.venues for select
  using (deleted_at is null or is_moderator(auth.uid()));

create policy venues_insert on public.venues for insert to authenticated
  with check (created_by = auth.uid());

create policy venues_update on public.venues for update to authenticated
  using (created_by = auth.uid() or is_moderator(auth.uid()))
  with check (created_by = auth.uid() or is_moderator(auth.uid()));

-- Soft-delete/restore gating, same shape as enforce_vendor_soft_delete.
create or replace function public.enforce_venue_soft_delete()
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
  if NEW.deleted_at is not null and OLD.created_by = v_uid then
    return NEW;
  end if;
  raise exception 'FORBIDDEN: only the poster (to delete) or a moderator (to delete/restore) can do this.';
end;
$$;

drop trigger if exists venues_soft_delete on public.venues;
create trigger venues_soft_delete before update on public.venues
  for each row execute function public.enforce_venue_soft_delete();

drop trigger if exists venues_rate_limit on public.venues;
create trigger venues_rate_limit before update on public.venues
  for each row execute function public.enforce_destructive_action_rate_limit();

-- ===== festivals.venue_id: one optional venue per rave =====
alter table public.festivals add column if not exists venue_id uuid references public.venues(id) on delete set null;

-- ===== venue_reviews: 1-5 stars + optional text, one per (venue, raver) =====
create table public.venue_reviews (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references public.venues(id) on delete cascade,
  raver_id      uuid not null references auth.users(id) on delete cascade,
  rating        integer not null check (rating between 1 and 5),
  body          text check (body is null or char_length(body) <= 300),
  deleted_at    timestamptz,
  deleted_by    uuid references auth.users(id),
  delete_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  photo_url     text,
  unique (venue_id, raver_id)
);

alter table public.venue_reviews enable row level security;

create index venue_reviews_venue_idx on public.venue_reviews (venue_id) where deleted_at is null;

create policy venue_reviews_select on public.venue_reviews for select
  using (deleted_at is null or is_moderator(auth.uid()));

create policy venue_reviews_insert on public.venue_reviews for insert to authenticated
  with check (raver_id = auth.uid());

create policy venue_reviews_update on public.venue_reviews for update to authenticated
  using (raver_id = auth.uid() or is_moderator(auth.uid()))
  with check (raver_id = auth.uid() or is_moderator(auth.uid()));

create or replace function public.enforce_venue_review_soft_delete()
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
  if NEW.deleted_at is not null and OLD.raver_id = v_uid then
    return NEW;
  end if;
  raise exception 'FORBIDDEN: only the review author (to delete) or a moderator (to delete/restore) can do this.';
end;
$$;

drop trigger if exists venue_reviews_soft_delete on public.venue_reviews;
create trigger venue_reviews_soft_delete before update on public.venue_reviews
  for each row execute function public.enforce_venue_review_soft_delete();

drop trigger if exists venue_reviews_rate_limit on public.venue_reviews;
create trigger venue_reviews_rate_limit before update on public.venue_reviews
  for each row execute function public.enforce_destructive_action_rate_limit();

-- Keep updated_at current when the author edits their review (upsert path).
create or replace function public.touch_venue_review_updated_at()
returns trigger language plpgsql as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$;

drop trigger if exists venue_reviews_touch_updated_at on public.venue_reviews;
create trigger venue_reviews_touch_updated_at before update on public.venue_reviews
  for each row execute function public.touch_venue_review_updated_at();
