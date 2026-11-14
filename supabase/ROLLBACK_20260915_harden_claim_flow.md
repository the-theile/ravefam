# Rollback for 20260915000000_harden_claim_flow

Pre-change definitions were captured 2026-09-15 and are identical to:
- claim_and_merge_raver  -> supabase/migrations/20260711000000_support_declined_items_on_direct_claim.sql
- find_raver_by_invite_code -> (prod-only, never in repo):

    CREATE OR REPLACE FUNCTION public.find_raver_by_invite_code(p_code text)
     RETURNS TABLE(qr_token text) LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
    AS $function$
      SELECT qr_token FROM ravers
      WHERE qr_token IS NOT NULL
        AND upper(left(replace(qr_token, '-', ''), 6)) = upper(p_code)
      LIMIT 1;
    $function$;

To restore the anon grant (NOT recommended - that is the P0):
    grant execute on function public.claim_and_merge_raver(text, uuid, jsonb) to anon;
