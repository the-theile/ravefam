-- Same fix, same root cause, third time: this project grants anon EXECUTE
-- on every new function via default privileges directly, not just via
-- PUBLIC, so `revoke all ... from public` never touches it. At this point
-- this is clearly not a one-off mistake but a standing property of this
-- project worth remembering explicitly for any future function here:
-- ALWAYS revoke anon by name, never rely on revoking PUBLIC alone.

revoke execute on function public.get_raver_points(uuid) from anon;
