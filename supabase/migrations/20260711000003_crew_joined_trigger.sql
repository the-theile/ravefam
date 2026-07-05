-- Fires the "you're in a crew now" email the moment someone (new or
-- existing user) joins their first crew. Crew invites today are a bare
-- shareable link (generateAndShareCrewInvite, app.html:12912) with no
-- invitee email ever collected, so there's no pre-signup "invited" moment
-- to hook -- join is the earliest real signal available.
create or replace function public.enqueue_crew_joined_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
begin
  select claimed_by into v_uid from public.ravers where id = NEW.raver_id;
  if v_uid is null then
    return NEW;
  end if;

  insert into public.email_drip_queue (user_id, step_key, scheduled_for)
    values (v_uid, 'crew_joined', now())
    on conflict (user_id, step_key) do nothing;

  return NEW;
end;
$$;

create trigger crew_members_enqueue_joined_email
  after insert on public.crew_members
  for each row execute function public.enqueue_crew_joined_email();
