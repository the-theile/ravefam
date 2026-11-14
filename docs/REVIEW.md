# RaveFAM review (app.html 2.40.0, 14 Nov 2026)

Read-only audit. Nothing in the app or the database was changed.

**How things were checked**

- Database: live policies, grants, triggers, function bodies, storage policies and advisors read from the `RaveFam` Supabase project (read-only SQL).
- Two things were confirmed with a live read-only request using the public anon key from `app.html`: storage listing (finding C1) and that anon cannot read the core tables.
- Client: read from `app.html`, `sw.js`, `vercel.json`, `capacitor.config.json` and `supabase/functions/*`.
- Nothing was run on a device, and no write was attempted against production. Findings that depend on device behaviour or on a write succeeding are marked **needs verification**.

Line numbers refer to `app.html` at 2.40.0 unless another file is named. Section names match `docs/APP_MAP.md`.

## Fix status (2.40.1)

The top 10 were addressed in 2.40.1, one commit per finding. Migrations are written but **not applied**; they are in `supabase/migrations/` for review.

| Finding | Client change | Migration (not applied) |
|---|---|---|
| C1 storage listing | none | `20261114000000_storage_stop_public_listing.sql` (has DROPs: paste into the SQL editor) |
| C2 removed members keep access | none | `20261114000100_membership_helpers_ignore_removed.sql` |
| C3 crewmate can overwrite profiles | `dbSaveRaver` sends only permitted columns for profiles that are not yours | `20261114000200_ravers_guard_non_owner_writes.sql` |
| H1 privacy bypass by direct read | the two `ravers` inserts return `id` only | `20261114000300_private_columns_and_rsvp_reads.sql` (apply after 2.40.1 is live) |
| H2 offline / slow signal | `supabase-js` self-hosted and precached; `sw.js` falls back to cache after 4 s | none |
| H3 `loadAllData` blanking and duplicates | single in-flight run, swap on success, retry with backoff | none |
| H4 no catch-up after wake | resync on visible-after-30 s and on `online`; `catchUpHuddleRoom` | none |
| H5 RSVP fan-out | shared catalogs re-read at most every 10 min | covered by the H1 migration |
| H6 Huddle message tampering, lost reactions | `toggleHuddleReaction` uses the RPC, falls back until it exists | `20261114000400_huddle_message_guard_and_reactions.sql` (apply after 2.40.1 is live) |
| M1 re-join by invite link | `confirmJoinCrew` reads `already_member`, handles `removed_by_lead` | `20261114000500_rejoin_crew_via_invite.sql` |
| M2 RSVP writes | ordered per rave, rolled back on failure, crew line posted after save (`toggleGoingToFest`) | none |
| M3 no request timeouts | `supaFetch` deadline: 20 s, 60 s for uploads | none |

Found while fixing C3: adding a vibe tag to a crewmate went through `dbSaveRaver`, which wrote the whole masked row back and so blanked that person's hidden phone, base and notes. The C3 client change stops it.

Still open from this list: a cold start with no signal now boots but has no data to show (H2 follow-up: cache the last good load), and M4 onwards.

---

## Critical

### C1. Anyone on the internet can list every Huddle photo, voice note and profile photo

- **Where:** storage policies `huddle_media_public_read`, `photos_public_read`, `profile_pics_public_read`, `festival_memories_public_read`, `festival_maps_read` on `storage.objects` (role `public`, command `SELECT`).
- **What's wrong:** these buckets are already public, which is enough for image URLs to load. The extra `SELECT` policy additionally lets the list endpoint work for anyone holding the anon key, and that key is in `app.html`. Confirmed: `POST /storage/v1/object/list/huddle-media` and `/photos` with the anon key return the folder tree (`crews/…`, `profiles/…`, `our-photos/…`).
- **Scenario:** someone who has never signed up walks `huddle-media/crews/<crewId>/<roomId>/` and downloads every photo and voice note a crew has sent in its private chat.
- **Smallest fix:** drop those five `SELECT` policies. Public URLs keep working without them. Later, consider making `huddle-media` a private bucket with signed URLs, since unguessable URLs are the only protection left after this fix.

### C2. People removed from a crew (or who left) keep full access to it

- **Where:** database functions `user_is_claimed_member_of_crew`, `user_is_claimed_member_of_crew_for_member`, `user_is_crewmate_of_raver`, `user_can_see_crew`, `user_shares_crew_with_user`. Client side: `dbRemoveCrewMember` (SUPABASE WRITE HELPERS, L16385–16394) and the `request_leave_crew` RPC both soft-delete by setting `crew_members.deleted_at`.
- **What's wrong:** none of the five helpers filter on `cm.deleted_at is null`, and almost every crew policy is built on them (crews, crew_members, huddle_rooms, huddle_messages read and insert, game plans, polls, ravers, storage upload to `huddle-media`). A soft-removed member still passes all of them. There are 7 such rows for claimed members in production today.
- **Scenario:** a leader removes someone after a falling-out. That person can still read every new Huddle message, post into the Huddle, see the Rave Plan (lodging, rides, money) and read crewmates' profiles, by calling the API with their own session. **Needs verification:** whether the crew also still shows in their Crews tab (the `crews` query at L15162 would still return it).
- **Smallest fix:** one migration adding `and cm.deleted_at is null` to the membership join in each helper (and `c.deleted_at is null` where a crew is joined).

### C3. Any crewmate can overwrite or detach any other crewmate's profile

- **Where:** policy `ravers_crew_update` on `public.ravers` (`USING` and `WITH CHECK` are both just "is a crewmate or leads a crew with this raver"). The only column guard is the trigger `enforce_raver_vibe_tag_privacy`, which covers vibe tags alone.
- **What's wrong:** the policy exists so crewmates can add vibe tags, but it permits an update of every column on a claimed profile: `name`, `handle`, `phone`, `instagram`, `avatar_url`, the four privacy flags, `claimed_by`, `status`, `deleted_at`, `merged_into`, `qr_token`. Policy and triggers were read; the write itself was not attempted (**needs verification** on a test account).
- **Scenario:** a crew of 30 picked up through a shared invite link. One member sends a single API call that sets another member's `claimed_by` to null. The victim opens the app, is no longer attached to their profile, and gets treated as a new user. Or their name and photo are quietly changed.
- **Smallest fix:** a `BEFORE UPDATE` trigger on `ravers`: when the caller is not the owner (`claimed_by`, or `created_by` while unclaimed) and not a moderator, reject any change outside `vibe_tags` and `custom_vibe_tags`. Check the client's crewmate edit paths first so the allowed list matches what the app really writes for unclaimed stubs.

---

## High

### H1. "Hide my phone number" and the other privacy toggles are bypassed by a direct read

- **Where:** policy `ravers_read` plus the table-level `SELECT` grant to `authenticated`; policies `raver_festivals_read`, `raver_festival_interest_read`, `raver_favorite_artists_read` (`auth.role() = 'authenticated'`).
- **What's wrong:** the app loads crewmates through `get_crewmate_ravers`, which masks `phone`, `base` and RSVPs according to the privacy flags (loadAllData, L15263–15275). The underlying table is still readable row-for-row by any crewmate, including `phone`, `claim_email`, `claim_phone`, `notes` and `qr_token`. The RSVP tables are readable by every signed-in user in the whole app, whatever `privacy_show_rsvps` says.
- **Scenario:** a member turns off "show my phone". A crewmate runs `select phone from ravers` through the REST API and gets it. Separately, any account at all can pull the full list of who is going to which rave (by raver id).
- **Smallest fix:** revoke column `SELECT` on `phone, claim_email, claim_phone, notes, qr_token, claim_code` from `authenticated` and serve them only through the two existing RPCs (the client's direct `ravers` selects need a pass first). Restrict the three RSVP read policies to own rows, crewmates and moderators.

### H2. No signal means no app, and weak signal means a long blank wait

- **Where:** `const sb = supabase.createClient(...)` at parse time (SUPABASE INIT, L11299); `supabase-js` loaded from jsDelivr (L57); `sw.js` `isPassthrough` (hosts starting `cdn.` skip the worker) and the network-first HTML branch with no timeout.
- **What's wrong:** the worker caches `app.html`, but never caches `supabase-js`. Offline, the cached page loads, `supabase` is undefined, the main script throws on its first statement and only the boot loader's Retry button is left. On a connection that is technically up but crawling, the HTML fetch waits for the network indefinitely before the cached copy is considered. In the iOS app the page comes from `https://myravefam.com/app`, so it behaves the same way (**needs verification** whether the service worker is active inside the WKWebView at all).
- **Scenario:** at Cyclops Cove with one bar. Someone opens the app to check where the crew is meeting and watches "Finding your crew…" until they give up.
- **Smallest fix:** (1) self-host `supabase-js` next to `qrcode.min.js` and add it to `PRECACHE`; (2) race the HTML fetch against a 3–4 s timer and serve the cached copy when the timer wins. A follow-up would be saving the last good `loadAllData` result to localStorage so crews and plans render read-only offline.

### H3. `loadAllData` empties the app before it knows the reload will work, and overlapping runs duplicate everything

- **Where:** `loadAllData` (L15121–15126 clear `festivals`, `squad`, `crews`; L15158–15169 fetch; errors at L15171, L15189, L15234 are skipped silently); `setupRealtimeSync` → `scheduleReload` (L14870–14879); 10 direct call sites.
- **What's wrong:** two separate problems.
  1. The arrays are cleared first. If any of the three queries fails, they stay empty and the next render shows no crews, with no error and no retry.
  2. There is no in-flight guard. Run A clears and awaits; run B clears and awaits; A pushes its rows; B pushes the same rows again. The per-call `seen` set does not span runs.
- **Scenario:** you join a crew on slow signal. `confirmJoinCrew` calls `loadAllData`, and the realtime echo of your own `crew_members` insert schedules a second one 800 ms later while the first is still waiting. Every crew and raver appears twice. Or the second run fails and your Crews tab goes empty mid-festival.
- **Smallest fix:** build into local arrays and swap them into the globals only after all three queries succeed; keep one shared in-flight promise so a second caller awaits the first instead of starting another.

### H4. Nothing catches up after the phone wakes or the connection returns

- **Where:** `setupRealtimeSync` (L14881–14891) and `subscribeHuddleRealtime` (L25795–25836) call `.subscribe()` with no status callback. The `online` handler (L40553–40560) only retries a pending claim. No `visibilitychange` handler reloads data.
- **What's wrong:** realtime only delivers what arrives while the socket is up. iOS suspends the socket when the phone locks or the app is backgrounded. On return, supabase-js reconnects but missed rows are never fetched.
- **Scenario:** phone in a pocket for an hour. Someone posts "meet at the totem in 10". You open the app straight into the Huddle you left open: the message is not there, and it will not appear until you leave the room and come back.
- **Smallest fix:** on becoming visible after more than ~30 s hidden, and on `online`: call the existing debounced reload, and if a Huddle room is open, fetch messages newer than the last one (the `loadNewerHuddleMessages` query already does this).

### H5. Every RSVP by anyone reloads the whole app on every connected phone

- **Where:** `setupRealtimeSync` L14885 (`raver_festivals`, all events, no filter) combined with the `raver_festivals_read` policy from H1; `loadAllData` background loads at L15131–15152.
- **What's wrong:** because every signed-in user may read every RSVP row, realtime delivers every RSVP change in the app to every client. Each one triggers a full `loadAllData`: three main queries plus about fifteen background loads, including the whole artists table (about 1,000 rows) and appearances (about 1,600).
- **Scenario:** the Eternal NYE push lands and 300 people are online tapping Going. Each tap makes all 300 phones re-download everything. Battery, data and the database all take the hit, and H3's race gets triggered constantly.
- **Smallest fix:** the RLS change in H1 scopes delivery to your own crews, which fixes most of it. On the client, load the catalogs (artists, appearances, venues, vendors badges) once per session rather than on every reload.

### H6. Any crew member can alter other people's Huddle messages, and simultaneous reactions overwrite each other

- **Where:** policy `huddle_messages_update` (any member, any row in the crew); trigger `enforce_huddle_message_edit` guards only `body` and `meetup_status`; `toggleHuddleReaction` (HUDDLE GIFS, L25398–25418) writes the whole `reactions` object back.
- **What's wrong:** a member can change `media_url`, `link`, `mentions`, `kind`, `sender_id`, `expires_at` or `reactions` on someone else's message. Separately, reactions are read-modify-write on the client, so two people reacting at the same moment lose one of the reactions.
- **Scenario:** the crew piles reactions onto a beacon; half of them vanish. Or a member swaps the photo on a leader's message for a different image and it still shows the leader as sender.
- **Smallest fix:** extend the edit trigger so a non-sender, non-moderator can change only `reactions` (plus the pin columns the pin trigger already governs). Move reactions to a small RPC that toggles one emoji for `auth.uid()` atomically; `toggle_crew_feed_reaction` is the existing pattern.

---

## Medium

### M1. Re-joining a crew through its invite link shows the full welcome but does nothing

- **Where:** RPC `join_crew_via_invite` ("Already in crew?" check ignores `deleted_at` and returns `{already_member: true}`); `confirmJoinCrew` (Crew invite link, L33806) tests `data.error === 'already_member'`.
- **What's wrong:** the RPC's membership check matches a soft-deleted row, so anyone who left or was removed is reported as already a member. The client looks for that under `error`, does not find it, and runs the success path.
- **Scenario:** Sam leaves a crew by mistake and taps the invite link again. Sam sees "IN THE FAM", the leader gets "Sam just joined via your invite link", and Sam is still not in the crew.
- **Smallest fix:** in the RPC, revive the soft-deleted row (clear `deleted_at`) instead of returning early; in the client, test `data.already_member`.

### M2. RSVP taps are not awaited and are never rolled back

- **Where:** Rave Focus toggle (L38873–38883), plus the other `dbAddRaverFestival` / `dbRemoveRaverFestival` call sites (L13697, L17428, L19633, L34627, L36514, L38892, L38907, L38992). The crew activity line is posted at L38864–38865 before the write.
- **What's wrong:** local state flips, the UI re-renders, the crew is told "X is going", and only then is the write fired without `await`. On failure there is a toast but the UI keeps showing Going. Two quick taps send an add and a delete with no ordering.
- **Scenario:** bad signal at the gate. You tap Going, the write fails, the toast is missed. Your crew's Huddle says you are going; the database says you are not; after the next reload you silently drop off the list.
- **Smallest fix:** await the write in the toggle, revert `festIds` and re-render on error, and post the activity line only after success.

### M3. Requests never time out

- **Where:** `supabase.createClient(SUPA_URL, SUPA_KEY)` (L11299) with no custom `fetch`; `sendHuddleMessage` (L24773–24807).
- **What's wrong:** on a stalled connection a request hangs until the OS gives up. A Huddle message stays "pending" with no failed state and no Retry.
- **Scenario:** you send "where are you?" as you lose signal. It sits greyed out for minutes; you cannot tell whether to resend.
- **Smallest fix:** pass `global: { fetch }` to `createClient` wrapping `fetch` with a 15 s `AbortSignal.timeout`, so existing error paths (the `_failed` bubble with Retry) fire.

### M4. Members who claimed a leader-made spot cannot read the crew's badge feed

- **Where:** policies `crew_feed_events_read`, `crew_achievements_read`, `raver_achievements_read` (all keyed on `crew_members.added_by = auth.uid()` or being the leader).
- **What's wrong:** `added_by` is whoever added the row, usually the leader. A member who claimed a spot the leader created does not match. 21 active memberships are in that state today. The same condition keeps granting access to someone who added members and has since been removed.
- **Scenario:** the leader sees badges and tier unlocks in FAM Pins; a claimed member's feed is empty. **Needs verification** in the app with a non-leader account.
- **Smallest fix:** replace the three conditions with `user_can_see_crew(crew_id)` (after C2 is fixed).

### M5. A crew leader can unlink any member's account, including profiles the leader did not create

- **Where:** RPC `disconnect_raver` (checks only `user_leads_crew_with_raver`); client `disconnectRaver` (PHOTO HELPERS, L17461–17475).
- **What's wrong:** the confirm copy describes undoing a claim on a leader-made spot. The RPC also works on someone who joined by link with their own long-standing profile, and it clears `claimed_by` globally, so they lose that profile in every crew.
- **Scenario:** a leader of one small crew disconnects a member who belongs to four crews. That member is logged into an account with no profile anywhere.
- **Smallest fix:** in the RPC, also require `created_by = auth.uid()` (or `created_by_leader_id = auth.uid()`) on the raver.

### M6. The crew join link does not survive a new tab, and "Maybe later" throws it away

- **Where:** `checkClaimParam` (L13539–13540) stores `?join=` in sessionStorage only, while `?claim=` also gets a localStorage backup; `processPendingCrewJoin` (L13867) removes the token before the modal is answered; `closeCrewJoinModal` (L33782–33786).
- **What's wrong:** if the tab is replaced before sign-in completes (iOS discarding the tab while the user is in Mail for the code, or the user installing the app from the Smart App Banner), the invite is gone. Tapping "Maybe later" also discards it with no way back except finding the original message.
- **Scenario:** a friend taps the invite, signs up, lands in an empty app with no crew and no hint why. **Needs verification** on a real iPhone for the tab-discard case.
- **Smallest fix:** mirror the claim behaviour: back the join token up in localStorage and clear it only after a successful join or a final server answer.

### M7. A message sent just before switching rooms can appear in the wrong room

- **Where:** `sendHuddleMessage` (L24797–24798).
- **What's wrong:** after the insert returns, the row is pushed into `huddleMessages` if the temp id is not found. If the user switched rooms meanwhile, `huddleMessages` now belongs to the new room. The mention notifications after it also read `_huddleActiveCrewId` post-await.
- **Scenario:** send in Main on slow signal, tap over to the festival room; your Main message shows at the bottom of the festival room until reload.
- **Smallest fix:** only push when `data.room_id === _huddleActiveRoomId`.

### M8. Batch-sending edge functions accept the public anon key

- **Where:** `supabase/functions/send-drip-emails`, `send-lifecycle-emails`, `send-lineup-alerts`, `send-set-reminders`, `send-beacon-push`, `send-beacon-email`, `send-mention-push`, `send-support-email` (`verify_jwt: true`, no further check in the handler; `send-waitlist-teaser` does check).
- **What's wrong:** `verify_jwt` accepts any valid project JWT and the anon key is one. Anyone can invoke these directly.
- **Scenario:** someone repeatedly calls `send-beacon-push` with a known beacon message id. **Needs verification:** how much the per-function log tables dedupe; the queue processors may be harmless to trigger early.
- **Smallest fix:** require the service-role key or a shared secret header in each handler, as `send-waitlist-teaser` already does.

### M9. Notifications can be forged between crewmates, and point toasts create duplicates

- **Where:** policy `notifs_insert` (any user sharing a crew may insert any row for you); `handlePointEventRealtimeInsert` (L14903) inserts a notification from the client for every point event.
- **What's wrong:** message text, type and link data are caller-supplied, so a crewmate can plant a notification that reads as coming from the system or from someone else. Separately, each open device inserts its own copy of every points notification.
- **Smallest fix:** create the points notification in the trigger that awards points (the `point_event_id` unique index already exists for this) and drop the client insert. Longer term, move cross-user notifications into RPCs or triggers.

### M10. First load is heavy for a festival network

- **Where:** `<head>` L41–60; `sw.js` HTML branch.
- **What's wrong:** every launch re-requests `app.html` network-first (about 580 KB gzipped when it has changed), six Google Font families load as render-blocking CSS, and html2canvas and cropper download on every boot although only share cards and photo crop use them.
- **Smallest fix:** load html2canvas and cropper on first use through the existing `loadScriptOnce`; trim the font request to the weights actually used. The H2 timeout covers the rest.

---

## Low

- **L1. Dead table with broken policies.** `checklist_items`: `checklist_read` is open to every signed-in user and `checklist_write` contains `cm.crew_id = cm.crew_id` (always true), so any claimed user could write any crew's rows. The table is empty and nothing in `app.html` references it. Drop the table or its policies.
- **L2. `softDeleteRow` reports success when RLS matched no rows** (L16409–16428). The restore helper below it already checks the row count; do the same here.
- **L3. The destructive-action rate limit counts rows the client writes itself.** `enforce_destructive_action_rate_limit` reads `audit_logs`, which is filled by `logAudit` in the browser. Skipping the log skips the limit. Write the audit row from the trigger.
- **L4. Huddle photos give no feedback while uploading** (`handleHuddlePhotoInput`, L25683–25699). Nothing appears until the upload finishes, and a failure cannot be retried without re-picking the photo.
- **L5. Presence and typing channels are open topics.** `crew-presence:<crewId>` and `huddle-presence:<roomId>` are not private channels, so anyone who knows the id can see first names and "where". Crew ids are returned by `get_crew_by_invite_token` to anyone holding an invite link.
- **L6. Small information leaks to any signed-in user:** `moderators_read` (all moderator user ids), `get_founding_testers`, `user_is_restricted(uid, kind)` for any uid.
- **L7. Owner email hard-coded** in two delete policies (`raver_festivals_delete`, `raver_favorite_artists_delete`), in `is_super_admin_uid`, and in public `app.html` (`ERUDA_ALLOWED_EMAILS`, L13310). Use `is_moderator` / a table, and drop the address from the client.
- **L8. Telegram webhook has no secret check** (`api/telegram.js`). Anyone can post fake updates; set and verify `X-Telegram-Bot-Api-Secret-Token`.
- **L9. Claim retried after a dropped response reads as "already claimed"** (`commitClaim`, L14587–14599). If the first call succeeded but the response was lost, the retry shows the "claimed" error to the person who just claimed it. On that error, reload and check whether the profile is now theirs.
- **L10. Onboarding after a failed boot load shows the wrong error.** If `loadAllData` failed, `squad` is empty, so `obStep2Next` (L41454–41489) inserts a second profile, hits the one-profile-per-user index and reports "That handle was just taken". Goes away with H3.
- **L11. Modal sizing (needs verification on device).** `.modal` (L3221–3230) has no `max-height` or scroll, modals are centred in a full-height fixed overlay, and only the Huddle locks body scroll and tracks `visualViewport`. On a small iPhone with the keyboard up, the crew-join modal's "Claim My Spot" button may sit under the keyboard. Thirteen `max-height: NNvh` rules also use `vh` rather than `dvh`.
- **L12. Database housekeeping from the advisors:** 193 policies call `auth.uid()` per row instead of `(select auth.uid())`; `crew_members(raver_id)`, `ravers(created_by)` and `raver_festivals(festival_id)` have no index although the membership helpers join on them; `storage_path_uuid` and `normalize_lineup_night` have a mutable `search_path`; trigger functions are executable through the REST API. None of this matters at today's size; it will at a few thousand users.

---

## Checked and found sound

- The anon key cannot read `ravers`, `crews`, `huddle_messages`, `raver_festivals` or `festivals` (confirmed live). Every public table has RLS enabled.
- Admin RPCs (`delete_user`, `suspend_user`, `get_admin_*`, `get_pm_dashboard_metrics`, and so on) are executable by anon but each checks `is_super_admin()` first.
- `claim_and_merge_raver` rejects anonymous callers, locks the stub row and only merges into the caller's own profile. Invite-code lookup is rate-limited per IP.
- Huddle message text can only be edited by its sender within 5 minutes; delete and pin are restricted by triggers.
- `link-preview` blocks private addresses and re-checks every redirect hop.
- Realtime channels are removed with `removeChannel` on room switch, crew change and sign-out; no leak found.
- iOS basics are in place: `100dvh` fallbacks, safe-area insets, 16 px inputs on touch devices, `visualViewport` handling for the Huddle composer, reduced-motion rules.
- User text is escaped through `escHtml` / `escJsAttr` in the paths read (Huddle bodies, crew join modal, QR modal). This was a spot check, not a full sweep of every `innerHTML`.

## Not covered

- Supabase Auth settings (OTP expiry, rate limits, Turnstile enforcement) are not visible through SQL.
- The native Swift code, widget and share extension under `ios/`.
- Vendor Village, Venue Directory, Stats, Radar and the admin dashboards were mapped but not read line by line.
- Device testing of any kind.
