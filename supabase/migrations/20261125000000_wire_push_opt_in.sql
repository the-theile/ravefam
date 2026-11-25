-- ===== RAVE WIRE: Fam HQ push opt-in =====
-- Fam HQ announcement pushes (send-wire-push) are promotional, so they are
-- opt-in (App Store guideline 4.5.4): default false, turned on only by the
-- "Fam HQ announcements" switch in Settings > Notifications. It stays out of
-- enableAllNativePushTypes on purpose so turning it on is always deliberate.
-- Same table and pattern as beacon_push_opt_in / mention_push_opt_in; the
-- table's existing grants and RLS cover the new column.

alter table public.email_preferences
  add column if not exists wire_push_opt_in boolean not null default false;
