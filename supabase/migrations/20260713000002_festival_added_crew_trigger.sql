-- "Your crew is tracking a new festival" re-engagement trigger -- broader
-- than festival_added_others: fires for every OTHER claimed member of any
-- crew the festival creator belongs to, not just someone whose profile was
-- directly edited. One festivals insert can fan out to several rows here,
-- one per crewmate. Same enqueue-time inactivity check as
-- enqueue_festival_added_others_email and the same reasoning: only enqueue
-- for crewmates who are ALREADY 21+ days inactive when the festival is
-- added, so the email stays timely.
create or replace function public.enqueue_festival_added_crew_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  for r in
    select distinct rv2.claimed_by as target_uid
    from public.ravers rv1
    join public.crew_members cm1 on cm1.raver_id = rv1.id and cm1.deleted_at is null
    join public.crew_members cm2 on cm2.crew_id = cm1.crew_id and cm2.raver_id <> cm1.raver_id and cm2.deleted_at is null
    join public.ravers rv2 on rv2.id = cm2.raver_id
    join auth.users u on u.id = rv2.claimed_by
    where rv1.claimed_by = NEW.created_by
      and rv2.claimed_by is not null
      and u.last_sign_in_at < now() - interval '21 days'
  loop
    insert into public.email_lifecycle_log (user_id, trigger_type, trigger_ref_id)
      values (r.target_uid, 'festival_added_crew', NEW.id::text)
      on conflict (user_id, trigger_type, trigger_ref_id) do nothing;
  end loop;

  return NEW;
end;
$$;

create trigger festivals_enqueue_added_crew_email
  after insert on public.festivals
  for each row execute function public.enqueue_festival_added_crew_email();

revoke execute on function public.enqueue_festival_added_crew_email() from public;
