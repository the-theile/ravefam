-- Dreamstate SoCal 2026: Discovery Project is off the published schedule.
-- Destructive, so applied via the Supabase dashboard SQL editor (see CLAUDE.md).
delete from public.artist_festival_appearances ap
using public.festivals f, public.artists a
where ap.festival_id = f.id and f.slug = 'dreamstate-socal-2026'
  and ap.artist_id = a.id and a.name_lower = 'discovery project';
