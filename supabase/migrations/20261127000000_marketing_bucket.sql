-- Public bucket for marketing assets (IG story frames, social images) so they
-- have stable public links. Reads go through the public object URL; there are
-- no storage.objects policies for this bucket, so only service_role (dashboard,
-- edge functions, ops scripts) can upload, replace or delete.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marketing', 'marketing', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
