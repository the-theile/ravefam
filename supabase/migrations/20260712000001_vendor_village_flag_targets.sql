-- Extend the flags system so vendor listings and vendor reviews are
-- reportable, same posture as photo/dream_pin/archive_link/poll/jam added in
-- 20260706000001.
alter table public.flags drop constraint if exists flags_target_type_check;
alter table public.flags add constraint flags_target_type_check
  check (target_type in (
    'raver','festival','crew','crew_member','vibe_tag',
    'photo','dream_pin','archive_link','poll','jam',
    'vendor','vendor_review'
  ));
