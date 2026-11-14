-- Say out loud that these tables are service-role-only.
--
-- Each has RLS enabled and no policies, which fails closed and is correct — the
-- edge functions that read and write them (send-beacon-push, send-mention-push,
-- send-beacon-email, send-drip-emails, send-lifecycle-emails) use the service
-- role, which bypasses RLS. Nothing in the client should ever reach them.
--
-- The Supabase linter reports this shape as rls_enabled_no_policy, which reads
-- like an oversight. Without a note saying otherwise, the obvious "fix" is to
-- add a permissive policy — which would expose delivery logs, and the email
-- addresses in the drip queue, to any authenticated user. Hence the comments.

COMMENT ON TABLE public.email_drip_queue IS
  'Service-role only. RLS enabled with no policies on purpose: written and read by the send-drip-emails edge function. Do not add policies — the client must never read this.';

COMMENT ON TABLE public.email_lifecycle_log IS
  'Service-role only. RLS enabled with no policies on purpose: delivery log for the lifecycle email functions. Do not add policies.';

COMMENT ON TABLE public.huddle_beacon_email_log IS
  'Service-role only. RLS enabled with no policies on purpose: per-recipient delivery log written by send-beacon-email. Do not add policies.';

COMMENT ON TABLE public.huddle_beacon_push_log IS
  'Service-role only. RLS enabled with no policies on purpose: per-recipient delivery log written by send-beacon-push. Do not add policies.';

COMMENT ON TABLE public.huddle_mention_push_log IS
  'Service-role only. RLS enabled with no policies on purpose: per-recipient delivery log written by send-mention-push. Do not add policies.';
