# RaveFAM

## Versioning

The app displays its version in the Settings modal (Privacy & Notifications),
sourced from `APP_VERSION` in `app.html` (search "APP_VERSION").

On any meaningful change to `app.html`, bump `APP_VERSION` using semantic
versioning (MAJOR.MINOR.PATCH):
- PATCH — bug fixes, visual tweaks
- MINOR — new features, non-breaking additions
- MAJOR — breaking changes or major overhauls

Keep the `version` field in `package.json` in sync with `APP_VERSION` —
they should always match.

## iOS releases

Native iOS changes (Swift, `capacitor.config.json`, plugins, entitlements,
Info.plist) ship in batched App Store releases. When a change touches them,
add a line under "Next iOS release" in `native/README.md` (and under
"After release" for any web change that must wait for that build).

## Supabase migrations

Since Oct 30 2026, Supabase no longer auto-grants Data API access to new
tables in `public`. Every migration that creates a table must grant access
explicitly in the same file, or supabase-js gets "permission denied". Grant
only what the client needs; RLS still applies on top:

```sql
grant select on public.my_table to anon;                                  -- only if logged-out reads are needed
grant select, insert, update, delete on public.my_table to authenticated; -- trim to what policies allow
grant select, insert, update, delete on public.my_table to service_role;  -- edge functions / cron
```

Tables only touched by `security definer` RPCs or edge functions need just
the `service_role` grant.

### Applying them from a cloud session (approval prompts)

Learned the hard way (Oct 17 – Nov 4 2026):

- Non-destructive migrations (create, alter, grant, revoke, functions) go
  through the Supabase connector's `apply_migration` with no prompt.
- Destructive SQL (`delete`, `drop`, `truncate`) makes the Supabase server ask
  its own confirmation question, on `apply_migration` *and* `execute_sql`.
- The owner only sees one pending approval at a time. If another session is
  stuck on an unanswered prompt, the new question never shows up, and the
  call times out after 60s ("The server asked the user a question…").

So, before any destructive DB call:

1. Run `list_sessions` (claude-code-remote) and look for one whose
   `needs_action` is "Approve or deny Supabase …". If there is one, stop and
   ask the owner to open that session and **Deny** it (approving would run
   that session's old, possibly stale SQL), then retry here.
2. Put all destructive statements in one call, so there's one prompt.
3. If it still times out, don't retry in a loop: give the owner the SQL to
   run in the Supabase dashboard's SQL editor.

Changes run through `execute_sql` or the dashboard aren't recorded in
`supabase_migrations.schema_migrations`; the committed migration file is the
record.
