-- The prior migration used CREATE OR REPLACE FUNCTION with an added
-- parameter, which Postgres treats as a distinct overload (function
-- identity includes the parameter signature) rather than a replacement.
-- That left both the old 2-arg claim_and_merge_raver(text, uuid) and the
-- new 3-arg claim_and_merge_raver(text, uuid, jsonb) defined at once, which
-- makes any 2-argument call ambiguous (the 3-arg version's p_declined
-- default also makes it callable with 2 args). Drop the stale 2-arg
-- overload so only the new one (with its own default) remains.
drop function if exists public.claim_and_merge_raver(text, uuid);
