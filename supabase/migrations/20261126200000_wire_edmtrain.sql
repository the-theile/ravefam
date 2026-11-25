-- ===== RAVE WIRE: shows near you (EDMTrain) =====
-- sync-edmtrain (edge function, daily) writes "<artist> is playing near you"
-- items for each home scene in use, only for artists someone there
-- favorited. Those items carry metro_id (+ artist_id), and wire_item_visible
-- shows them only to ravers whose home scene is that metro AND who
-- favorited that artist. They are lineup-kind items marked meta.near, so the
-- kind check stays as it is.
--
-- EDMTrain terms: each event shows its EDMTrain link unmodified (link_url),
-- data is never shown more than 24 hours old (expires_at = sync + 24h), and
-- past events are not stored (the sync removes them). The function does
-- nothing until the EDMTRAIN_API_KEY secret is set.
-- No destructive statements, so this stays apply_migration-safe.

alter table public.wire_items
  add column if not exists metro_id text references public.scene_metros(id) on delete set null;
create index if not exists wire_items_metro_idx on public.wire_items (metro_id) where metro_id is not null;

create or replace function public.wire_item_visible(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.wire_items w
    where w.id = p_item_id
      and w.hidden_at is null
      and w.starts_at <= now()
      and w.expires_at > now()
      and (
        w.crew_id is null
        or exists (select 1 from public.crews c
                   where c.id = w.crew_id and c.deleted_at is null and c.leader_id = auth.uid())
        or public.user_is_claimed_member_of_crew(w.crew_id)
      )
      -- Near-you items: your home scene, and (if it names one) an artist you favorited.
      and (
        w.metro_id is null
        or (exists (select 1 from public.raver_home_scene h
                    where h.user_id = auth.uid() and h.metro_id = w.metro_id)
            and (w.artist_id is null
                 or exists (select 1 from public.raver_favorite_artists fa
                            join public.ravers r on r.id = fa.raver_id
                            where fa.artist_id = w.artist_id and r.claimed_by = auth.uid() and r.deleted_at is null)))
      )
      and not exists (select 1 from public.user_blocks b
                      where b.blocker_id = auth.uid() and b.blocked_id = w.actor_user_id)
  );
$$;

-- Daily at 13:17 UTC (5:17 AM Pacific), before the morning check.
select cron.schedule('sync-edmtrain', '17 13 * * *', $$
  select net.http_post(
    url := 'https://tvpgopciioqbqmjjjigh.supabase.co/functions/v1/sync-edmtrain',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
$$);
