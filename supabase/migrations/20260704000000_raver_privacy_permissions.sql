-- Raver-controlled privacy & permission toggles.
-- Lets a claimed raver control: who can add them to festivals, who can
-- suggest vibe tags on their profile, and whether their base location /
-- RSVP history is visible to other viewers. Phone visibility reuses the
-- existing phone_visible column (predates this migration) — no change here.
--
-- Defaults are all `true` (community-open) so behavior is unchanged for
-- every existing row until an owner explicitly locks something down.
alter table public.ravers
  add column allow_festival_adds  boolean not null default true,
  add column allow_vibe_tags      boolean not null default true,
  add column privacy_base_visible boolean not null default true,
  add column privacy_show_rsvps   boolean not null default true;

-- No RLS change needed: ravers_update (20260703000000_moderators_and_perms_rls.sql,
-- lines 23-25) already permits updates by created_by/claimed_by/moderator on
-- the whole row, which covers these new columns automatically.
