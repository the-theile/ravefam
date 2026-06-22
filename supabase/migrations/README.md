# Supabase migrations

SQL migrations for the RaveFam database (project `tvpgopciioqbqmjjjigh`).

## Convention

Each file is named `<version>_<name>.sql`, where `<version>` is a UTC
`YYYYMMDDHHMMSS` timestamp — matching the Supabase migration history table
(`supabase_migrations.schema_migrations`). Files are applied in version order.

## Baseline note

This folder was started on 2026-06-22 to begin tracking schema changes in the
repo. The database already had **62** migrations in its history at that point
(earliest `20260606192315`); those earlier migrations were applied directly via
the Supabase dashboard/MCP and are recorded in the remote migration table but
are **not** all backfilled here yet. The files present here are the changes made
from this point forward. To reconstruct an earlier migration's SQL, read its
`statements` from `supabase_migrations.schema_migrations`.

## Applying

These migrations have already been applied to the remote project. `supabase db
push` skips any version already recorded remotely, so re-running is safe.
