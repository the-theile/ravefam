-- Invite-code lookup: rate limit + smaller signed-out claim preview.
--
-- find_raver_by_invite_code (hardened in 20260915000000, live in production)
-- is granted to anon and resolves a 6-hex-char code (16.7M values) to an
-- unclaimed stub's qr_token. Nothing limited how fast a caller could guess,
-- and get_claim_preview then returned the whole stub to an anonymous caller:
-- base, instagram, notes, met_story, festivals.
--
-- 1. find_raver_by_invite_code allows 10 lookups per client IP per 10 minutes
--    (60 for callers with no IP header, so a missing header can't lock the
--    whole site out). Over the limit it raises 'rate_limited' (P0001), which
--    the app shows as "too many tries".
-- 2. get_claim_preview returns only what the signed-out splash and the link
--    preview use (name, gradient, avatar_url, the crew) when auth.uid() is
--    null. Signed-in callers get the full payload the claim review needs —
--    unchanged from production.
--
-- Not applied by this change -- review and apply deliberately.

-- ── 1 ─────────────────────────────────────────────────────────────────────
create table if not exists public.invite_code_attempts (
  id           bigint generated always as identity primary key,
  client_key   text        not null,
  attempted_at timestamptz not null default now()
);
create index if not exists invite_code_attempts_key_time
  on public.invite_code_attempts (client_key, attempted_at desc);
-- Only the security-definer function below touches it.
alter table public.invite_code_attempts enable row level security;
revoke all on public.invite_code_attempts from anon, authenticated;

create or replace function public.find_raver_by_invite_code(p_code text)
 returns table(qr_token text)
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_headers json := nullif(current_setting('request.headers', true), '')::json;
  v_ip      text := coalesce(
                      v_headers ->> 'cf-connecting-ip',
                      v_headers ->> 'x-real-ip',
                      nullif(trim(split_part(v_headers ->> 'x-forwarded-for', ',', 1)), ''));
  v_key     text := coalesce(v_ip, 'no-ip');
  v_limit   int  := case when v_ip is null then 60 else 10 end;
  v_recent  int;
begin
  delete from invite_code_attempts
   where client_key = v_key and attempted_at < now() - interval '1 hour';

  select count(*) into v_recent
    from invite_code_attempts
   where client_key = v_key and attempted_at > now() - interval '10 minutes';
  if v_recent >= v_limit then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into invite_code_attempts (client_key) values (v_key);

  return query
    select r.qr_token
    from ravers r
    where r.qr_token is not null
      and r.claimed_by is null
      and r.status = 'unclaimed'
      and upper(left(replace(r.qr_token, '-', ''), 6)) = upper(p_code)
      and (
        select count(*)
        from ravers r2
        where r2.qr_token is not null
          and r2.claimed_by is null
          and r2.status = 'unclaimed'
          and upper(left(replace(r2.qr_token, '-', ''), 6)) = upper(p_code)
      ) = 1;
end;
$function$;

grant execute on function public.find_raver_by_invite_code(text) to anon, authenticated;

-- ── 2 ─────────────────────────────────────────────────────────────────────
-- Body copied from production (pg_get_functiondef, 2026-09-30); the only
-- change is the signed-out branch before the final return.
create or replace function public.get_claim_preview(p_token text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_raver             ravers%rowtype;
  v_crew              crews%rowtype;
  v_member_count      integer;
  v_claimer_name      text;
  v_fest_ids          uuid[];
  v_interested_fest_ids uuid[];
  v_fav_artist_ids     bigint[];
  v_crew_json          jsonb;
begin
  select * into v_raver from ravers where qr_token = p_token limit 1;

  if not found then
    return jsonb_build_object('error', 'invalid_token');
  end if;

  -- Catch both already-claimed and already-merged stubs
  if v_raver.claimed_by is not null or v_raver.status != 'unclaimed' then
    select r2.name into v_claimer_name
    from ravers r2
    where r2.claimed_by = v_raver.claimed_by
    limit 1;
    return jsonb_build_object(
      'error',        'already_claimed',
      'raver_name',   v_raver.name,
      'claimer_name', coalesce(v_claimer_name, 'a crew member')
    );
  end if;

  select c.* into v_crew
  from crews c
  join crew_members cm on cm.crew_id = c.id
  where cm.raver_id = v_raver.id
  limit 1;

  if v_crew.id is not null then
    select count(*) into v_member_count
    from crew_members cm
    join ravers r on r.id = cm.raver_id
    where cm.crew_id = v_crew.id
      and (r.claimed_by is not null or r.status = 'claimed');
  else
    v_member_count := 0;
  end if;

  v_crew_json := case
    when v_crew.id is not null then jsonb_build_object(
      'id',           v_crew.id,
      'name',         v_crew.name,
      'color',        coalesce(v_crew.color, '#FF2D78'),
      'gradient',     v_crew.gradient,
      'status',       v_crew.status,
      'member_count', v_member_count
    )
    else null
  end;

  -- Signed out: just enough for the invite card and link preview.
  if auth.uid() is null then
    return jsonb_build_object(
      'raver', jsonb_build_object(
        'id',         v_raver.id,
        'name',       v_raver.name,
        'gradient',   coalesce(v_raver.gradient, 'linear-gradient(135deg,#FF2D78,#BF00FF)'),
        'avatar_url', v_raver.avatar_url
      ),
      'crew', v_crew_json
    );
  end if;

  select array_agg(rf.festival_id) into v_fest_ids
  from raver_festivals rf
  where rf.raver_id = v_raver.id;

  select array_agg(rfi.festival_id) into v_interested_fest_ids
  from raver_festival_interest rfi
  where rfi.raver_id = v_raver.id;

  select array_agg(rfa.artist_id) into v_fav_artist_ids
  from raver_favorite_artists rfa
  where rfa.raver_id = v_raver.id;

  return jsonb_build_object(
    'raver', jsonb_build_object(
      'id',                  v_raver.id,
      'name',                v_raver.name,
      'handle',              v_raver.handle,
      'base',                v_raver.base,
      'instagram',           v_raver.instagram,
      'radiate',             v_raver.radiate,
      'gradient',            coalesce(v_raver.gradient, 'linear-gradient(135deg,#FF2D78,#BF00FF)'),
      'avatar_url',          v_raver.avatar_url,
      'genres',              coalesce(v_raver.genres, '{}'),
      'favorite_artist_ids', coalesce(to_jsonb(v_fav_artist_ids), '[]'::jsonb),
      'vibe_tags',           coalesce(v_raver.vibe_tags, '{}'),
      'custom_vibe_tags',    coalesce(v_raver.custom_vibe_tags, '{}'),
      'notes',               coalesce(v_raver.notes, ''),
      'met_story',           coalesce(v_raver.met_story, ''),
      'festival_ids',        coalesce(to_jsonb(v_fest_ids), '[]'::jsonb),
      'interested_fest_ids', coalesce(to_jsonb(v_interested_fest_ids), '[]'::jsonb)
    ),
    'crew', v_crew_json
  );
end;
$function$;
