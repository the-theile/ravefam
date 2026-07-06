-- Extend the flags system so vendor_spots is reportable too — same posture
-- as the vendor/vendor_review widening in 20260712000001.
alter table public.flags drop constraint if exists flags_target_type_check;
alter table public.flags add constraint flags_target_type_check
  check (target_type in (
    'raver','festival','crew','crew_member','vibe_tag',
    'photo','dream_pin','archive_link','poll','jam',
    'vendor','vendor_review','vendor_spot'
  ));
