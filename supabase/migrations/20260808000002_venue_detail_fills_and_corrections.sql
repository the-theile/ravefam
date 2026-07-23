-- ===== Venue detail fill-in + correction for medium-confidence venues =====
-- Follow-up to 20260808000001. Two things:
--  1. Correction: EDC Orlando's actual home is Tinker Field, a historic
--     former baseball stadium site next to Camping World Stadium
--     (grandstands demolished 2015, used as EDC Orlando's grounds since
--     2011) -- not "Orlando Amphitheater (Central Florida Fairgrounds)",
--     which was a wrong guess. Per user correction.
--  2. Fills description/website/instagram (researched via web search) for
--     the venues that were previously created with only a name + location.
--
-- Each field-level update only fires when that field is still NULL, so this
-- won't clobber anything a user has since edited by hand via the app's Edit
-- Listing flow; the rename only fires while the old guessed name is still
-- in place, so this is safe to replay on any environment.

update public.venues
  set name = 'Tinker Field',
      website_url = coalesce(website_url, 'https://www.orlandofield.com/')
  where name = 'Orlando Amphitheater (Central Florida Fairgrounds)';

update public.venues set description = 'Historic 230-acre outdoor concert venue and campground in central Ohio (formerly Buckeye Lake Music Center), hosting concerts since the 1970s -- home of Lost Lands since 2017.'
  where name = 'Legend Valley' and description is null;
update public.venues set website_url = 'https://legendvalleymusic.com/'
  where name = 'Legend Valley' and website_url is null;
update public.venues set instagram = '@legendvalleyconcertvenue'
  where name = 'Legend Valley' and instagram is null;

update public.venues set description = 'Year-round resort with a waterpark, golf, and camping in Rothbury, MI -- home of Electric Forest''s "Sherwood Forest" since 2011.'
  where name = 'Double JJ Resort' and description is null;
update public.venues set website_url = 'https://doublejj.com/'
  where name = 'Double JJ Resort' and website_url is null;
update public.venues set instagram = '@doublejjresort'
  where name = 'Double JJ Resort' and instagram is null;

update public.venues set description = 'Historic former baseball stadium site (built 1923, grandstands demolished 2015) next to Camping World Stadium in downtown Orlando -- home of EDC Orlando since 2011.'
  where name = 'Tinker Field' and description is null;

update public.venues set description = '800-acre multi-use event venue in Okeechobee, FL -- home of the Okeechobee Music & Arts Festival.'
  where name = 'Sunshine Grove' and description is null;
update public.venues set website_url = 'https://www.sunshinegroveflorida.com/'
  where name = 'Sunshine Grove' and website_url is null;

update public.venues set description = 'Premier multi-use event facility in Scottsdale, AZ -- hosts Day Trip/Night Trip Arizona and other large-scale events.'
  where name = 'WestWorld of Scottsdale' and description is null;
update public.venues set website_url = 'https://westworldaz.com/'
  where name = 'WestWorld of Scottsdale' and website_url is null;
update public.venues set instagram = '@westworldofscottsdale'
  where name = 'WestWorld of Scottsdale' and instagram is null;

update public.venues set description = 'Downtown Orlando''s entertainment district -- eight bars and restaurants hosting daytime events and high-energy weekend block parties.'
  where name = 'Wall Street Plaza' and description is null;
update public.venues set website_url = 'https://wallstreetorlando.com/'
  where name = 'Wall Street Plaza' and website_url is null;
update public.venues set instagram = '@wallstreetorlando'
  where name = 'Wall Street Plaza' and instagram is null;

-- Confirmed (not just guessed) via search: HARD Summer's 2026 edition
-- (Aug 1-2, matching this rave's date) is announced at Hollywood Park.
update public.venues set description = '300-acre entertainment destination surrounding SoFi Stadium in Inglewood, CA -- confirmed host of HARD Summer''s 2026 edition.'
  where name = 'Hollywood Park' and description is null;
update public.venues set website_url = 'https://hollywoodparkca.com/'
  where name = 'Hollywood Park' and website_url is null;
update public.venues set instagram = '@hollywoodparkca'
  where name = 'Hollywood Park' and instagram is null;
