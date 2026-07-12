-- Crew totem: curated icon option, peer to the existing totem photo.
-- Active-choice-only — a crew has at most one of totem_photo_url / totem_icon set.
-- No DB-level exclusivity constraint: mirrors the existing convention on this table
-- (status/color have no CHECK constraints either); the client clears one when the
-- other is set.
alter table public.crews add column if not exists totem_icon text;

comment on column public.crews.totem_icon is
  'Key into the client-side TOTEM_ICONS catalog (app.html). Null when no icon totem is set. Mutually exclusive with totem_photo_url — client clears one when the other is set.';
