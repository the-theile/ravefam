-- Cache for Huddle link previews (the link-preview edge function). One row per
-- URL, shared by everyone, so a link dropped in a busy crew is fetched once.
-- Only the edge function (service_role) reads or writes it.
create table if not exists public.link_previews (
  url        text primary key,
  data       jsonb not null,
  fetched_at timestamptz not null default now()
);

alter table public.link_previews enable row level security;

grant select, insert, update, delete on public.link_previews to service_role;
