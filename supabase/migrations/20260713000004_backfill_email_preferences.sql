-- email_preferences rows are only auto-created for users who sign up AFTER
-- the on_auth_user_created_email_setup trigger (20260711000000) existed.
-- The lifecycle re-engagement system specifically targets long-inactive
-- existing users -- almost by definition, people who predate that trigger
-- and therefore have no email_preferences row at all. Without this backfill,
-- send-lifecycle-emails' opt-out check (`if (!prefs) skip`) would silently
-- treat every pre-existing user as opted out, which defeats the entire
-- point of this feature.
insert into public.email_preferences (user_id, email_cached)
select u.id, u.email
from auth.users u
left join public.email_preferences ep on ep.user_id = u.id
where ep.user_id is null
on conflict (user_id) do nothing;
