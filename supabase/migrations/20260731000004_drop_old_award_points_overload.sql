-- Fix for a bug caught by live testing right after 20260731000001: adding a
-- new trailing parameter to award_points() via CREATE OR REPLACE did NOT
-- replace the v1 (6-arg) function -- Postgres identifies functions by name
-- + full parameter type list, so a 7th parameter makes it a distinct
-- overload, not a replacement. Both signatures then matched a 5-positional-
-- arg call ambiguously ("function ... is not unique"), breaking
-- claim_and_merge_raver() as soon as it tried to award points.
--
-- Same class of bug this codebase already hit once before, fixed the same
-- way -- see 20260619071648_fix_claim_and_merge_raver_overload.sql and
-- 20260704233047_drop_old_claim_and_merge_raver_overload.sql. The lesson
-- there evidently didn't generalize to "don't add trailing params via
-- CREATE OR REPLACE either" -- noting it plainly here for next time.

drop function if exists public.award_points(uuid, text, text, uuid, text, jsonb);
