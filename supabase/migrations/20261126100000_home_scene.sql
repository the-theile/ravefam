-- ===== HOME SCENE (Rave Wire phase 2) =====
-- Each raver gets a home scene (a metro) so the Wire can show shows near
-- them. ravers.base stays free text; scene_match() reads it:
--   "Sarasota, FL" -> tampa   "orlando" -> orlando   "Brooklyn NY" -> new-york
--   "Hollywood, FL" -> miami  vs  "Hollywood, CA" -> los-angeles
--   "florida" / "world" -> no match, so the app asks once (📍 Set your home scene)
-- my_home_scene() matches on read while the scene is auto, so editing your
-- base re-matches it; once picked by hand (or skipped) it sticks.
-- edmtrain_location_id is filled later by the EDMTrain sync.
-- No destructive statements, so this stays apply_migration-safe.

create table if not exists public.scene_metros (
  id                    text primary key,
  name                  text not null,
  state                 text not null,             -- 2-letter code
  aliases               text[] not null default '{}',  -- normalized city names in the metro
  lat                   double precision,
  lng                   double precision,
  edmtrain_location_id  integer,
  sort                  integer not null default 100
);

create table if not exists public.raver_home_scene (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  metro_id    text references public.scene_metros(id) on delete set null,
  source      text not null check (source in ('auto','picked','skipped')),
  updated_at  timestamptz not null default now()
);

alter table public.scene_metros     enable row level security;
alter table public.raver_home_scene enable row level security;
-- The metro list is reference data anyone signed in may read.
create policy scene_metros_read on public.scene_metros for select to authenticated using (true);
-- Home scenes are reached only through the RPCs below.
revoke all on public.scene_metros from anon, authenticated;
grant select on public.scene_metros to authenticated;
grant select, insert, update, delete on public.scene_metros to service_role;
revoke all on public.raver_home_scene from anon, authenticated;
grant select, insert, update, delete on public.raver_home_scene to service_role;

insert into public.scene_metros (id, name, state, lat, lng, sort, aliases) values
  ('orlando',       'Orlando',             'FL', 28.54, -81.38, 10, array['orlando','kissimmee','winter park','sanford','lake mary','altamonte springs','oviedo','apopka','clermont','winter garden','celebration','ocoee','longwood','daytona beach','daytona','deland']),
  ('tampa',         'Tampa Bay',           'FL', 27.95, -82.46, 11, array['tampa','st petersburg','st pete','clearwater','sarasota','bradenton','lakewood ranch','brandon','lakeland','wesley chapel','largo','palm harbor','riverview','venice','new port richey','plant city']),
  ('miami',         'Miami / South Florida','FL', 25.76, -80.19, 12, array['miami','miami beach','fort lauderdale','ft lauderdale','west palm beach','boca raton','hollywood','hialeah','delray beach','pompano beach','coral springs','pembroke pines','doral','homestead','jupiter','boynton beach','key west','kendall']),
  ('jacksonville',  'Jacksonville',        'FL', 30.33, -81.66, 13, array['jacksonville','jax','st augustine','orange park','fernandina beach','ponte vedra','ponte vedra beach','jacksonville beach','fleming island','middleburg']),
  ('gainesville',   'Gainesville / North Central FL','FL', 29.65, -82.32, 14, array['gainesville','ocala','lake city','live oak','alachua','high springs']),
  ('fort-myers',    'Fort Myers / Naples', 'FL', 26.64, -81.87, 15, array['fort myers','ft myers','naples','cape coral','bonita springs','estero','punta gorda']),
  ('space-coast',   'Space Coast',         'FL', 28.08, -80.61, 16, array['melbourne','cocoa','cocoa beach','titusville','palm bay','rockledge','merritt island','vero beach']),
  ('tallahassee',   'Tallahassee',         'FL', 30.44, -84.28, 17, array['tallahassee']),
  ('pensacola',     'Pensacola',           'FL', 30.42, -87.22, 18, array['pensacola','destin','fort walton beach','navarre','panama city','panama city beach']),
  ('atlanta',       'Atlanta',             'GA', 33.75, -84.39, 30, array['atlanta','atl','decatur','marietta','alpharetta','sandy springs','athens']),
  ('new-york',      'New York',            'NY', 40.71, -74.01, 31, array['new york','new york city','nyc','brooklyn','queens','manhattan','bronx','staten island','jersey city','hoboken','newark','long island']),
  ('los-angeles',   'Los Angeles',         'CA', 34.05, -118.24, 32, array['los angeles','la','long beach','pasadena','hollywood','santa monica','anaheim','irvine','orange county','burbank','glendale','san bernardino','riverside']),
  ('las-vegas',     'Las Vegas',           'NV', 36.17, -115.14, 33, array['las vegas','vegas','henderson','north las vegas']),
  ('san-francisco', 'San Francisco Bay Area','CA', 37.77, -122.42, 34, array['san francisco','sf','oakland','san jose','berkeley','bay area','palo alto','fremont']),
  ('san-diego',     'San Diego',           'CA', 32.72, -117.16, 35, array['san diego','chula vista','oceanside','carlsbad','escondido']),
  ('phoenix',       'Phoenix',             'AZ', 33.45, -112.07, 36, array['phoenix','tempe','scottsdale','mesa','chandler','glendale','gilbert']),
  ('denver',        'Denver',              'CO', 39.74, -104.99, 37, array['denver','boulder','morrison','aurora','lakewood','fort collins','colorado springs']),
  ('chicago',       'Chicago',             'IL', 41.88, -87.63, 38, array['chicago','evanston','naperville','oak park']),
  ('dallas',        'Dallas / Fort Worth', 'TX', 32.78, -96.80, 39, array['dallas','fort worth','arlington','plano','irving','denton','frisco']),
  ('austin',        'Austin',              'TX', 30.27, -97.74, 40, array['austin','round rock','san marcos']),
  ('houston',       'Houston',             'TX', 29.76, -95.37, 41, array['houston','katy','the woodlands','sugar land','galveston']),
  ('san-antonio',   'San Antonio',         'TX', 29.42, -98.49, 42, array['san antonio','new braunfels']),
  ('seattle',       'Seattle',             'WA', 47.61, -122.33, 43, array['seattle','tacoma','bellevue','everett','redmond','george']),
  ('portland',      'Portland',            'OR', 45.52, -122.68, 44, array['portland','beaverton','vancouver']),
  ('boston',        'Boston',              'MA', 42.36, -71.06, 45, array['boston','cambridge','somerville','worcester','providence']),
  ('philadelphia',  'Philadelphia',        'PA', 39.95, -75.17, 46, array['philadelphia','philly','camden']),
  ('washington-dc', 'Washington, DC',      'DC', 38.91, -77.04, 47, array['washington','washington dc','dc','alexandria','silver spring','bethesda','baltimore']),
  ('charlotte',     'Charlotte',           'NC', 35.23, -80.84, 48, array['charlotte','raleigh','durham','greensboro']),
  ('nashville',     'Nashville',           'TN', 36.16, -86.78, 49, array['nashville','murfreesboro','franklin']),
  ('new-orleans',   'New Orleans',         'LA', 29.95, -90.07, 50, array['new orleans','nola','baton rouge','metairie']),
  ('detroit',       'Detroit',             'MI', 42.33, -83.05, 51, array['detroit','ann arbor','dearborn']),
  ('minneapolis',   'Minneapolis',         'MN', 44.98, -93.27, 52, array['minneapolis','st paul','twin cities']),
  ('salt-lake-city','Salt Lake City',      'UT', 40.76, -111.89, 53, array['salt lake city','slc','provo','ogden'])
on conflict (id) do nothing;

-- Normalize a city name the same way the aliases are written.
create or replace function public.scene_norm(p text)
returns text language sql immutable set search_path = public, pg_temp
as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(p, '')),
           '\m(saint|st\.)\s*', 'st ', 'g'),     -- saint / st. -> st
           '[^a-z0-9, ]', ' ', 'g'),             -- punctuation -> space
           '\s+', ' ', 'g'))
$$;

-- Full state names (and a few spellings) to 2-letter codes.
create or replace function public.scene_state_code(p text)
returns text language sql immutable set search_path = public, pg_temp
as $$
  select case
    when p is null or btrim(p) = '' then ''
    when char_length(btrim(p)) = 2 then btrim(p)
    else coalesce((select code from (values
      ('florida','fl'),('georgia','ga'),('new york','ny'),('california','ca'),('nevada','nv'),('arizona','az'),
      ('colorado','co'),('illinois','il'),('texas','tx'),('washington','wa'),('oregon','or'),('massachusetts','ma'),
      ('pennsylvania','pa'),('district of columbia','dc'),('north carolina','nc'),('tennessee','tn'),
      ('louisiana','la'),('michigan','mi'),('minnesota','mn'),('utah','ut'),('new jersey','nj'),
      ('rhode island','ri'),('maryland','md'),('virginia','va')) s(name, code)
      where s.name = btrim(p)), btrim(p))
  end
$$;

-- Free-text base -> metro id, or null when unsure.
create or replace function public.scene_match(p_base text)
returns text language plpgsql stable set search_path = public, pg_temp
as $$
declare
  t text := public.scene_norm(p_base);
  v_city text;
  v_state text := '';
  v_words text[];
  v_ids text[];
begin
  if t = '' then return null; end if;
  if position(',' in t) > 0 then
    v_city := btrim(split_part(t, ',', 1));
    v_state := public.scene_state_code(btrim(split_part(t, ',', 2)));
  else
    -- "orlando fl" / "brooklyn new york": peel a trailing state off.
    v_words := regexp_split_to_array(t, ' ');
    if array_length(v_words, 1) >= 2 and char_length(v_words[array_length(v_words, 1)]) = 2
       and v_words[array_length(v_words, 1)] in (select lower(state) from public.scene_metros union select 'nj' union select 'ri' union select 'md' union select 'va') then
      v_state := v_words[array_length(v_words, 1)];
      v_city := array_to_string(v_words[1:array_length(v_words, 1) - 1], ' ');
    else
      v_city := t;
      -- A spelled-out state at the end ("brooklyn new york").
      select s.code, btrim(left(t, char_length(t) - char_length(s.name))) into v_state, v_city
      from (values ('new york','ny'),('florida','fl'),('california','ca'),('texas','tx'),('georgia','ga'),('nevada','nv')) s(name, code)
      where t like '% ' || s.name
      limit 1;
      if v_city is null or v_city = '' then v_city := t; v_state := ''; end if;
    end if;
  end if;
  v_state := coalesce(v_state, '');

  select array_agg(m.id order by m.sort) into v_ids
  from public.scene_metros m
  where (v_city = any (m.aliases) or v_city = public.scene_norm(m.name))
    and (v_state = '' or v_state = lower(m.state));

  -- One clear match only; "hollywood" with no state is ambiguous.
  if coalesce(array_length(v_ids, 1), 0) = 1 then return v_ids[1]; end if;
  return null;
end;
$$;

-- The caller's home scene, matching from their base while it's auto.
create or replace function public.my_home_scene()
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  h public.raver_home_scene;
  v_base text;
  v_match text;
begin
  if v_uid is null then return null; end if;
  select * into h from public.raver_home_scene where user_id = v_uid;

  if h.user_id is null or h.source = 'auto' then
    select r.base into v_base from public.ravers r
    where r.claimed_by = v_uid and r.merged_into is null and r.deleted_at is null
    order by r.is_you desc nulls last limit 1;
    v_match := public.scene_match(v_base);
    if v_match is not null then
      insert into public.raver_home_scene (user_id, metro_id, source) values (v_uid, v_match, 'auto')
      on conflict (user_id) do update set metro_id = excluded.metro_id, updated_at = now()
        where public.raver_home_scene.source = 'auto' and public.raver_home_scene.metro_id is distinct from excluded.metro_id;
      select * into h from public.raver_home_scene where user_id = v_uid;
    end if;
  end if;

  return jsonb_build_object(
    'metro_id', h.metro_id,
    'name', (select m.name from public.scene_metros m where m.id = h.metro_id),
    'source', h.source,
    'needs_pick', h.user_id is null   -- never matched, picked or skipped
  );
end;
$$;

-- Pick a scene by hand, or pass null to skip ("not listed").
create or replace function public.set_home_scene(p_metro_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'set_home_scene: sign in first' using errcode = '42501'; end if;
  if p_metro_id is not null and not exists (select 1 from public.scene_metros where id = p_metro_id) then
    raise exception 'set_home_scene: unknown scene';
  end if;
  insert into public.raver_home_scene (user_id, metro_id, source)
  values (auth.uid(), p_metro_id, case when p_metro_id is null then 'skipped' else 'picked' end)
  on conflict (user_id) do update set metro_id = excluded.metro_id, source = excluded.source, updated_at = now();
  return public.my_home_scene();
end;
$$;

revoke all on function public.scene_norm(text) from public, anon;
revoke all on function public.scene_state_code(text) from public, anon;
revoke all on function public.scene_match(text) from public, anon;
revoke all on function public.my_home_scene() from public, anon;
revoke all on function public.set_home_scene(text) from public, anon;
grant execute on function public.my_home_scene() to authenticated;
grant execute on function public.set_home_scene(text) to authenticated;
