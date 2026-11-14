-- Ticket type (GA/VIP/Backstage/Other) a raver can select for their RSVP.
-- Optional and editable after the fact from the Rave Focus popup — RaveFAM
-- never required this before, so it stays nullable rather than backfilled.
alter table public.raver_festivals
  add column ticket_type text null,
  add column ticket_type_other text null;

alter table public.raver_festivals
  add constraint raver_festivals_ticket_type_check
    check (ticket_type is null or ticket_type in ('ga','vip','backstage','other'));

alter table public.raver_festivals
  add constraint raver_festivals_ticket_type_other_check
    check (ticket_type_other is null or ticket_type = 'other');

comment on column public.raver_festivals.ticket_type is
  'Ticket tier the raver selected for this RSVP: ga | vip | backstage | other. Null = not set.';
comment on column public.raver_festivals.ticket_type_other is
  'Free-text label when ticket_type = ''other''. Null otherwise.';

-- No UPDATE policy on raver_festivals exists anywhere in tracked migration
-- history — the table predates it, and until now the app only ever
-- inserted/selected/deleted rows here, never updated one in place. Add a
-- policy scoped to the same ownership rule already used for festival-add
-- privacy (enforce_raver_festival_add_privacy, 20260709000001) and the
-- festivals RSVP-block check (20260706000000): the raver's claimer, or its
-- creator while still unclaimed, or a moderator.
drop policy if exists raver_festivals_update on public.raver_festivals;
create policy raver_festivals_update on public.raver_festivals for update
  using (
    exists (
      select 1 from public.ravers r
      where r.id = raver_festivals.raver_id
        and (coalesce(r.claimed_by, r.created_by) = auth.uid() or public.is_moderator(auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from public.ravers r
      where r.id = raver_festivals.raver_id
        and (coalesce(r.claimed_by, r.created_by) = auth.uid() or public.is_moderator(auth.uid()))
    )
  );
