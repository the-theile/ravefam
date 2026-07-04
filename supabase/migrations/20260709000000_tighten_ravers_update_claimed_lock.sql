-- 20260707000001 tightened ravers_delete to require claimed_by IS NULL,
-- matching raverPerms().canDelete's !isClaimed invariant — but the actual
-- soft-delete/edit path goes through UPDATE (softDeleteRow sets deleted_at
-- via .update()), not DELETE, so ravers_delete was the wrong policy to fix.
-- ravers_update still let the original creator edit/soft-delete a raver row
-- forever, even after another user legitimately claimed it. Tighten to match
-- the same invariant: creator rights end at claim time; only the claimer or
-- a moderator can act on a claimed profile from then on.
drop policy if exists ravers_update on public.ravers;
create policy ravers_update on public.ravers for update
  using (((auth.uid() = created_by) and claimed_by is null) or (auth.uid() = claimed_by) or is_moderator(auth.uid()))
  with check (((auth.uid() = created_by) and claimed_by is null) or (auth.uid() = claimed_by) or is_moderator(auth.uid()));
