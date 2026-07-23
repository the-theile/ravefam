-- ===== One-time backfill: venues for existing raves =====
-- Reviewed the existing rave catalog and identified venues for raves where
-- either (a) the venue was literally stated in the rave's name (e.g. "Tiesto
-- @Fisher Pavilion"), or (b) it's a well-known festival with a fixed home
-- venue (e.g. Lost Lands -> Legend Valley, OH). Attributed to the app
-- owner's account, same as if they'd posted each venue by hand. Only
-- name/location are set — description/links/cover photo are left for manual
-- follow-up.
--
-- Idempotent: each row looks up the venue by (name, created_by) before
-- inserting, and only links a festival if it doesn't already have a
-- venue_id (so re-running this — e.g. against a fresh branch — won't
-- duplicate venues or clobber a venue a user has since changed by hand).
do $$
declare
  v_owner uuid := 'e76d8813-ad34-4270-b0b5-ae5859e77a31'; -- Theile (app owner)
  v_id uuid;
  r record;
begin
  for r in
    select * from (values
      -- High confidence: venue stated in the rave's name, or already the rave's location.
      ('Fisher Pavilion', 'Seattle, Washington, United States',
        array['fd8fad61-db3c-4b4e-9ef6-f8c082f91b32', 'c8c3e347-5684-4674-ab78-43a59f02da9a']::uuid[]),
      ('The RITZ Ybor', 'Ybor City, Florida, United States',
        array['703e3db0-30d0-4c18-92d9-91ad9a5d16e0', 'cbcf9825-209b-4968-9446-1820f0e380f4']::uuid[]),
      ('PNE Amphitheatre', 'Vancouver, British Columbia, Canada',
        array['03aea830-d2bf-4961-a46f-ce373c1c0627']::uuid[]),
      ('Myth Nightclub', 'Jacksonville, Florida, United States',
        array['e0c394bf-47c3-4878-a64b-bd990402d97d']::uuid[]),
      ('Harbour Convention Centre', 'Vancouver, British Columbia, Canada',
        array['b352195c-9d97-454d-b488-f19e94765931']::uuid[]),
      ('Showbox SoDo', 'Seattle, Washington, United States',
        array['58ef48b2-8d00-4027-a751-3e446cba59d9']::uuid[]),
      ('WaMu Theater', 'Seattle, Washington, United States',
        array['4a656e4b-aa8c-4d2e-889e-ad01e6da79e4']::uuid[]),
      ('Cannonball Arts', 'Seattle, Washington, United States',
        array['5d8bf804-d811-4ccb-8e01-ebdd1b1ab2a6']::uuid[]),
      ('Factory Town', 'Miami, Florida, United States',
        array['e82f55cc-b175-479d-aac8-46722fac7efe', 'a0062dd3-c532-43e1-b552-60401a353a15']::uuid[]),
      ('The Vanguard', 'Orlando, Florida, United States',
        array['9f7007d6-770b-49f1-92cd-b52bc12babcf', '41b0b33d-57ea-4052-bf01-89d2aa026b63']::uuid[]),
      ('Brick Park (Pioneer Square)', 'Seattle, Washington, United States',
        array['88b3e0b9-b430-45bf-9433-05e44ac952e7']::uuid[]),
      ('Spirit of the Suwannee Music Park', 'Live Oak, Florida, United States',
        array['f5eca6ef-8579-4cd3-b590-10ce421d5cac']::uuid[]),
      ('NOS Events Center', 'San Bernardino, California, United States',
        array['1487a613-6380-4b5d-b4e7-b532b36da60e']::uuid[]),

      -- Medium confidence: no venue stated in the rave's name, identified
      -- from general knowledge of the festival's usual/announced venue.
      ('Legend Valley', 'Thornville, Ohio, United States',
        array['eac58209-4421-4e33-90a7-0e493cad4625']::uuid[]),
      ('Double JJ Resort', 'Rothbury, Michigan, United States',
        array['d950cd01-580d-42e9-9e63-afcc453a7e84']::uuid[]),
      ('Orlando Amphitheater (Central Florida Fairgrounds)', 'Orlando, Florida, United States',
        array['127ed01d-86ea-428a-b15d-c5c442af3fb0', '2a7c26e4-e9ec-449d-a07b-baa54b82f9cd']::uuid[]),
      ('Sunshine Grove', 'Okeechobee, Florida, United States',
        array['d383daf9-f6b8-42d1-b78a-d74447e5e573']::uuid[]),
      ('WestWorld of Scottsdale', 'Scottsdale, Arizona, United States',
        array['4c3bcb15-fff2-45bf-97e8-b861c925d553']::uuid[]),
      ('Wall Street Plaza', 'Orlando, Florida, United States',
        array['a827249c-5a63-4b29-808a-33af2cdf4051']::uuid[]),

      -- Lowest confidence of the batch — Hard Summer's venue has moved
      -- between sites in past years; "Inglewood, California" points at
      -- Hollywood Park, but this one is the most worth double-checking.
      ('Hollywood Park', 'Inglewood, California, United States',
        array['99085234-30bf-4210-a688-3acc013a9152']::uuid[])
    ) as t(v_name, v_location, v_fest_ids)
  loop
    select id into v_id from public.venues where name = r.v_name and created_by = v_owner limit 1;
    if v_id is null then
      insert into public.venues (created_by, name, location) values (v_owner, r.v_name, r.v_location) returning id into v_id;
    end if;
    update public.festivals set venue_id = v_id where id = any(r.v_fest_ids) and venue_id is null;
  end loop;
end $$;
