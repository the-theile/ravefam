-- ravers_delete allowed the original creator to delete a raver row forever,
-- even after it was claimed by a real user — but the client's raverPerms()
-- has always intended canDelete to require !isClaimed (creator loses delete
-- rights once claimed). Tighten RLS to match that invariant.
drop policy if exists ravers_delete on public.ravers;
create policy ravers_delete on public.ravers for delete
  using (((auth.uid() = created_by) and claimed_by is null) or is_moderator(auth.uid()));
