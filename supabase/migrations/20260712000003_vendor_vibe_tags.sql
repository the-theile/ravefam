-- Vendor vibe tags (Feature 2): preset-only curated descriptors ("PLUR
-- Approved", "Hydration Hero", ...) any raver can tap onto a vendor listing.
-- No free text, no catalog table — tag_id is a code-defined preset id, same
-- unvalidated-preset-id posture as ravers.vibe_tags already in prod.
--
-- Modeled on vendor_festival_tags' shape, WITH ONE DELIBERATE DEVIATION: the
-- delete policy here also allows the original tagger to remove their own
-- tag. vendor_festival_tags intentionally disallows that (to stop anyone
-- from stripping a vendor's festival credibility), but that concern doesn't
-- apply to a personal opinion tag — undoing your own tap is a different,
-- lower-stakes action than removing someone else's claim.
create table public.vendor_vibe_tags (
  vendor_id  uuid not null references public.vendors(id) on delete cascade,
  tag_id     text not null check (char_length(tag_id) <= 40),
  tagged_by  uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (vendor_id, tag_id)
);

alter table public.vendor_vibe_tags enable row level security;

create index vendor_vibe_tags_tag_idx on public.vendor_vibe_tags (tag_id);

create policy vvt_select on public.vendor_vibe_tags for select using (true);

create policy vvt_insert on public.vendor_vibe_tags for insert to authenticated
  with check (tagged_by = auth.uid());

create policy vvt_delete on public.vendor_vibe_tags for delete to authenticated
  using (
    tagged_by = auth.uid()
    or exists (select 1 from public.vendors v where v.id = vendor_id and v.created_by = auth.uid())
    or is_moderator(auth.uid())
  );
