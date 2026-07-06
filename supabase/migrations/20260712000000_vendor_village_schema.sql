-- ===== VENDOR VILLAGE: vendors, festival tags, reviews, saves =====
-- A community vendor directory: any raver can post a vendor they buy from
-- (in person at festivals, or online) and it goes live immediately — no
-- pre-approval queue. Bad listings are handled after the fact via the
-- existing flags/report system (see 20260712000001), same posture as
-- crew_jams/dream_board_pins. Vendors are a standalone directory (works for
-- online-only/affiliate brands) that can also be optionally tagged to
-- specific festivals they're seen at in person (many-to-many).
create table public.vendors (
  id               uuid primary key default gen_random_uuid(),
  created_by       uuid not null references auth.users(id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 1 and 80),
  category         text not null check (category in (
                     'apparel_merch', 'jewelry_kandi', 'glass_art',
                     'gear_accessories', 'safety_comfort', 'food_drink',
                     'services', 'other'
                   )),
  description      text check (description is null or char_length(description) <= 600),
  website_url      text check (website_url is null or website_url ~* '^https?://'),
  instagram        text,
  cover_photo_url  text,
  -- Monetization groundwork — no billing integration yet, just the fields.
  -- 'official' marks a RaveFAM-seeded affiliate/promo listing (e.g. a
  -- Soft-Landings-style earplug brand) vs a regular community post.
  -- is_sponsored/sponsor_priority drive paid placement later; both are
  -- moderator-only to change (enforced by trigger below), not self-service.
  source           text not null default 'community' check (source in ('community', 'official')),
  is_sponsored     boolean not null default false,
  sponsor_priority integer not null default 0,
  deleted_at       timestamptz,
  deleted_by       uuid references auth.users(id),
  delete_reason    text,
  created_at       timestamptz not null default now()
);

alter table public.vendors enable row level security;

create index vendors_active_idx on public.vendors (deleted_at) where deleted_at is null;
create index vendors_category_idx on public.vendors (category) where deleted_at is null;
create index vendors_sponsor_sort_idx on public.vendors (sponsor_priority desc, created_at desc) where deleted_at is null;

create policy vendors_select on public.vendors for select
  using (deleted_at is null or is_moderator(auth.uid()));

create policy vendors_insert on public.vendors for insert to authenticated
  with check (created_by = auth.uid());

-- Creator can edit their own listing's non-sponsorship fields; moderators can
-- edit anything. Sponsorship fields are additionally locked down below.
create policy vendors_update on public.vendors for update to authenticated
  using (created_by = auth.uid() or is_moderator(auth.uid()))
  with check (created_by = auth.uid() or is_moderator(auth.uid()));

-- Soft-delete/restore gating, same shape as enforce_our_photos_soft_delete
-- (standalone rather than reusing enforce_crew_content_soft_delete, since
-- that helper assumes a crew_id fallback that doesn't apply to vendors).
create or replace function public.enforce_vendor_soft_delete()
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

drop trigger if exists vendors_soft_delete on public.vendors;
create trigger vendors_soft_delete before update on public.vendors
  for each row execute function public.enforce_vendor_soft_delete();

drop trigger if exists vendors_rate_limit on public.vendors;
create trigger vendors_rate_limit before update on public.vendors
  for each row execute function public.enforce_destructive_action_rate_limit();

-- Sponsorship fields are moderator-only to change, even though vendors_update
-- above lets the creator update other fields (name/description/links/photo).
create or replace function public.enforce_vendor_sponsorship_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (NEW.is_sponsored is distinct from OLD.is_sponsored
      or NEW.sponsor_priority is distinct from OLD.sponsor_priority
      or NEW.source is distinct from OLD.source)
     and not public.is_moderator(auth.uid()) then
    raise exception 'FORBIDDEN: only a moderator can change sponsorship fields.';
  end if;
  return NEW;
end;
$$;

drop trigger if exists vendors_sponsorship_guard on public.vendors;
create trigger vendors_sponsorship_guard before update on public.vendors
  for each row execute function public.enforce_vendor_sponsorship_fields();

-- ===== vendor_festival_tags: many-to-many, vendor <-> festival =====
create table public.vendor_festival_tags (
  vendor_id   uuid not null references public.vendors(id) on delete cascade,
  festival_id uuid not null references public.festivals(id) on delete cascade,
  tagged_by   uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (vendor_id, festival_id)
);

alter table public.vendor_festival_tags enable row level security;

create index vendor_festival_tags_festival_idx on public.vendor_festival_tags (festival_id);

create policy vft_select on public.vendor_festival_tags for select using (true);

-- Anyone can tag a vendor to a festival (crowdsourced, same open-posting
-- posture as the vendor itself) but only the vendor's own creator or a
-- moderator can untag — otherwise anyone could strip a vendor's tags.
create policy vft_insert on public.vendor_festival_tags for insert to authenticated
  with check (tagged_by = auth.uid());

create policy vft_delete on public.vendor_festival_tags for delete to authenticated
  using (
    exists (select 1 from public.vendors v where v.id = vendor_id and v.created_by = auth.uid())
    or is_moderator(auth.uid())
  );

-- ===== vendor_reviews: 1-5 stars + optional text, one per (vendor, raver) =====
create table public.vendor_reviews (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid not null references public.vendors(id) on delete cascade,
  raver_id      uuid not null references auth.users(id) on delete cascade,
  rating        integer not null check (rating between 1 and 5),
  body          text check (body is null or char_length(body) <= 300),
  deleted_at    timestamptz,
  deleted_by    uuid references auth.users(id),
  delete_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (vendor_id, raver_id)
);

alter table public.vendor_reviews enable row level security;

create index vendor_reviews_vendor_idx on public.vendor_reviews (vendor_id) where deleted_at is null;

create policy vendor_reviews_select on public.vendor_reviews for select
  using (deleted_at is null or is_moderator(auth.uid()));

create policy vendor_reviews_insert on public.vendor_reviews for insert to authenticated
  with check (raver_id = auth.uid());

-- Editable by the author (the upsert-on-conflict edit path reuses this) or a moderator.
create policy vendor_reviews_update on public.vendor_reviews for update to authenticated
  using (raver_id = auth.uid() or is_moderator(auth.uid()))
  with check (raver_id = auth.uid() or is_moderator(auth.uid()));

create or replace function public.enforce_vendor_review_soft_delete()
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

drop trigger if exists vendor_reviews_soft_delete on public.vendor_reviews;
create trigger vendor_reviews_soft_delete before update on public.vendor_reviews
  for each row execute function public.enforce_vendor_review_soft_delete();

drop trigger if exists vendor_reviews_rate_limit on public.vendor_reviews;
create trigger vendor_reviews_rate_limit before update on public.vendor_reviews
  for each row execute function public.enforce_destructive_action_rate_limit();

-- Keep updated_at current when the author edits their review (upsert path).
create or replace function public.touch_vendor_review_updated_at()
returns trigger language plpgsql as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$;

drop trigger if exists vendor_reviews_touch_updated_at on public.vendor_reviews;
create trigger vendor_reviews_touch_updated_at before update on public.vendor_reviews
  for each row execute function public.touch_vendor_review_updated_at();

-- ===== saved_vendors: raver bookmarks a vendor =====
create table public.saved_vendors (
  raver_id   uuid not null references auth.users(id) on delete cascade,
  vendor_id  uuid not null references public.vendors(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (raver_id, vendor_id)
);

alter table public.saved_vendors enable row level security;

create policy saved_vendors_own on public.saved_vendors for all to authenticated
  using (raver_id = auth.uid())
  with check (raver_id = auth.uid());
