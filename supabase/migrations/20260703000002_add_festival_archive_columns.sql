-- "Archive" is a non-destructive alternative to deleting a festival: it hides
-- the festival from the active Raves list without touching RSVPs, crew links,
-- or any other data. Offered to the creator/moderator when delete is blocked
-- because other people have RSVPed.
alter table public.festivals
  add column archived_at timestamptz null,
  add column archived_by uuid null references auth.users(id);
