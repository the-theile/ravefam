-- get_crew_by_invite_token existed live but was never captured in a tracked
-- migration, so a fresh DB rebuilt from migrations would be missing it and
-- the crew-level ?join= invite flow (pre-auth preview + post-auth join)
-- would silently break. Recording the current live definition verbatim.
create or replace function public.get_crew_by_invite_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_crew  crews%rowtype;
  v_count integer;
begin
  select * into v_crew from crews where invite_token = p_token;
  if not found then
    return jsonb_build_object('error', 'invalid_token');
  end if;
  if v_crew.status <> 'recruiting' then
    return jsonb_build_object('error', 'not_recruiting', 'crew_name', v_crew.name, 'status', v_crew.status);
  end if;
  select count(*) into v_count
  from crew_members cm join ravers r on r.id = cm.raver_id
  where cm.crew_id = v_crew.id and (r.claimed_by is not null or r.status = 'claimed');
  return jsonb_build_object(
    'id',             v_crew.id,
    'name',           v_crew.name,
    'color',          coalesce(v_crew.color, '#FF2D78'),
    'gradient',       v_crew.gradient,
    'status',         v_crew.status,
    'totem_photo_url',v_crew.totem_photo_url,
    'member_count',   v_count
  );
end;
$function$;
