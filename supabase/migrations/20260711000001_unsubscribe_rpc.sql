-- Public, no-login unsubscribe endpoint driven by the token in each drip
-- email's footer link (unsubscribe.html?u=<token>).
create or replace function public.unsubscribe_by_token(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.email_preferences
    set unsubscribed_at = now(),
        marketing_opt_in = false
    where unsub_token = p_token;
end;
$$;

grant execute on function public.unsubscribe_by_token(uuid) to anon, authenticated;
