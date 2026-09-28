# Crew Activation Analytics

RaveFAM's growth unit is the **crew**, not the individual user, and the North Star
metric is Weekly Active Crews. This document describes the instrumentation that lets
us measure real crew activation instead of vanity metrics (signups, pageviews, etc.).

## Overview

There is no third-party analytics SDK (no PostHog/Segment/Mixpanel) in this app. This
instrumentation follows the same first-party pattern already used for the PM dashboard's
`pageviews`/`client_errors`/`preview_clicks` tables (see
`supabase/migrations/20260804000000_pm_dashboard_metrics.sql` and
`supabase/migrations/20260806000000_pm_dashboard_schema_extensions.sql`):

- A plain Postgres table (`analytics_events`) with RLS locked to `using (false)` —
  no client can read or write it directly.
- A single `security definer` RPC, `log_analytics_event(...)`, granted to
  `anon, authenticated`, is the only way to insert a row.
- The client calls it fire-and-forget via
  `sb.rpc('log_analytics_event', {...}).then(() => {}, () => {})` — no `await`,
  errors swallowed, matching `logClientError`/`log_pageview`. Non-blocking and
  low-overhead by construction.
- **The `.then()` is required.** supabase-js v2 query builders are lazy: a bare
  `sb.rpc(...)` that is never awaited or `.then()`-ed never sends its request.
  Until 1.66.0 every fire-and-forget logging call (here, `lineup-common.js` and
  `index.html`) lacked it, so `pageviews`, `preview_clicks`, `client_errors`,
  `cta_clicks` and `analytics_events` never received a row. Numbers start from
  that release.
- `log_analytics_event()` only accepts event names on its allowlist
  (`20260927000004_analytics_event_allowlist.sql`); unknown names are dropped.
  Add a new event's name there when adding the event.

`analytics_events` is **product/growth data**, distinct in purpose from `audit_logs`
(the moderation trail written by `logAudit()` at `app.html:10938`, used for things like
crew-member removals and content moderation). Don't conflate the two.

## Event catalog

All events are logged via `logAnalyticsEvent(eventName, { crew_id, raver_id, ...properties })`
(`app.html`, defined next to `logClientError`), which calls the `log_analytics_event` RPC.
`user_id` is never sent from the client — the RPC reads it server-side from `auth.uid()`.

| Event | Fired from | crew_id | raver_id | properties | Dedup key |
|---|---|---|---|---|---|
| `crew_created` | `createCrew()` → `dbSaveCrew()`'s success callback (`app.html:20357`, `10767`) | ✅ (new crew) | — | — | none needed (insert only happens once per crew by construction) |
| `first_person_added` | `dbAddCrewMember()` (`app.html:10798`) for post-creation adds; `dbSaveCrewMembers()` (`app.html:10784`) for the bulk add during crew creation | ✅ | ✅ | — | `(crew_id, event_name)` unique |
| `first_invite_sent` | `showQRModal()` (`app.html:8656`, `mode: 'qr_or_code'`); its inline "Copy link" button (`mode: 'link'`); `shareInviteLink()` (`app.html:20591`, `mode: 'share'` or `'link'`); `generateAndShareCrewInvite()` (`app.html:20713`, `mode: 'crew_link'`) | ✅ | ✅ (except crew-link invites) | `mode` | `(crew_id, event_name)` unique |
| `first_claim` | `commitClaim()` (`app.html:9226`), after `claim_and_merge_raver` RPC succeeds | ✅ (`_pendingPostClaimCrewId`) | ✅ (`claimedId`) | — | `(crew_id, event_name)` unique |
| `first_event_added` | `saveRave()`'s create branch, inside `dbSaveFestival()`'s success callback (`app.html:24552`) — fired once per crew the acting user leads (`_ledCrews`) | ✅ (one row per led crew) | — | `festival_id` | `(crew_id, event_name)` unique |
| `first_rsvp_updated` | `toggleGoingToFest()` (`app.html:24265`, `direction: 'going'`); `toggleInterestedInFest()` (`app.html:24372`, `direction: 'interested'`) — only on the "add" side of each toggle; also the Lineup Explorer first-star sheet (`source: 'explorer'`) and the /app picks handoff (`source: 'explorer_handoff'`) | — | ✅ | `festival_id`, `direction`, `source` (explorer paths only) | `(raver_id, event_name)` unique |
| `return_within_7_days` | `bootApp()` (`app.html:9618`), right after `loadAllData()` resolves | — | — | — | `(user_id, event_name, created_at::date)` unique — once per user per calendar day |
| `signup_completed` | `logSignupCompletedIfNew()` in `bootApp()`, on the first boot of an account created in the last 24h | — | — | `source` (`explorer` if this browser opened a Lineup Explorer page first, via `rf_first_explorer`; else `other`), `first_explorer_page` | once per user (checked in the RPC; signed-in callers only) |
| `explorer_save_click` | `goSave()` in `lineup-explorer/lineup-common.js`: "Save my picks" / "Save to RaveFAM" on a lineup page or the hub | — | ✅ if a member | `slug` (rave the handoff starts on), `picks`, `page` (`hub` or the page slug) | none (one row per tap) |
| `picks_handoff_saved` | `savePicksHandoff()` in `app.html`, after the Welcome to the fam sheet saves browser ☆ picks | — | — | `festivals`, `picks`, `failed` | none (one row per save) |
| `lineup_share_created` | Share sheet opened in `lineup-common.js` (`openShareSheet()`), after `get_or_create_share_link` returns | — | ✅ | `slug`, `picks` | none |
| `lineup_share_posted` | `postToHuddle()` in `lineup-common.js`, after the `lineup` message is posted to a crew's rave Huddle | — | ✅ | `slug`, `picks` | none |
| `lineup_share_opened` | `loadShared()` in `lineup-common.js`, when a `?by=` link resolves for the page | — | ✅ if a member | `slug`, `picks` | none |
| `set_time_suggested` | `openSuggestSheet()` in `lineup-common.js`, when `suggest_set_time()` accepts a suggestion or change report | — | ✅ | `slug`, `kind` (`suggest` / `report`) | none |
| `now_next_opened` | `renderNow()` in `lineup-common.js`, the first time 🎧 On deck shows on a page load | — | ✅ if a member | `slug`, `auto` (opened itself during festival hours vs. tapped) | none |
| `reminder_enabled` | `toggleReminders()` in `lineup-common.js`, when `set_set_reminders()` turns set reminders on | — | ✅ | `slug`, `n` (sets queued for a reminder) | none |
| `postfest_checkoff` | `finishCheckoff()` in `lineup-common.js` and `postfestFinish()` in `app.html`, when "Who'd you catch? 📼" is answered or closed with Done | — | ✅ | `slug` (explorer) or `festival_id` (app), `saw`, `missed`, `source` (`explorer` / `app`) | none; `raver_postfest_checkoffs` allows one per raver and rave |

The PM dashboard's **🔭 Lineup Explorer → Members** section (`get_explorer_metrics()`,
`20260927000005_explorer_metrics.sql`) joins first explorer pageviews to
`signup_completed` on `visitor_id` (`rf_vid`) to report the weekly
explorer-to-member rate.

## Activated Crew definition

`is_crew_activated(p_crew_id uuid) returns boolean` (Postgres function,
`supabase/migrations/20260809000000_crew_activation_analytics.sql`) considers a crew
**activated** when, within 7 days of `crews.created_at`, all of the following are true:

1. **A leader exists** — implicit: `crews.leader_id` is set at row-insert time
   (`dbSaveCrew`, `app.html:10776`) and can't be null for a real crew.
2. **A person was added** beyond the founding member — a `first_person_added` row
   exists for the crew.
3. **An event is tracked** for the crew — a `first_event_added` row exists for the
   crew (see "Known attribution gaps" below for how this is determined).
4. **An attendance or invite action occurred** — a `first_invite_sent` row exists for
   the crew, OR a `first_claim` row exists for the crew, OR any claimed member of the
   crew (joined via `crew_members` → `ravers.claimed_by`) has a `first_rsvp_updated`
   row.

**`return_within_7_days` is NOT a 5th condition.** It's tracked separately as a
retention metric in the weekly funnel — don't assume a crew needs a return visit to
be "activated."

Query a single crew: `select is_crew_activated('<crew-uuid>');` (requires
`authenticated` role).

## Known attribution gaps

- **`first_event_added` → all led crews, not necessarily "the" triggering crew.**
  `festivals` has no `crew_id` column — a rave is a shared entity any of a user's
  crews can RSVP into, and the "Add Rave" UI doesn't carry crew context (it's launched
  from the global Events tab, not a crew-detail screen). We attribute the event to
  every crew the acting user leads (`_ledCrews`), the same heuristic `saveRave()`
  already uses to decide who gets notified about the new rave. A rave added by a
  non-leader member won't attribute to that crew — an existing product bias, not a
  new inconsistency introduced by this instrumentation.
- **Bulk-add race during crew creation.** `createCrew()` can add several members to
  a brand-new crew while `dbSaveCrew()`'s insert is still in flight; those go through
  `dbSaveCrewMembers()` (bulk insert), a different function from the post-creation
  `dbAddCrewMember()` (single-row upsert). Both are instrumented, and the
  `(crew_id, event_name)` unique index means only the first row from either path
  survives, so this is safe — just worth knowing there are two call sites for the
  same event.
- **Onboarding self-claim isn't `first_claim`.** `commitHandle()`/`obStep2Next()`
  set `status: 'claimed'` on the user's *own* profile during initial handle/genre
  setup, with no crew context in scope — that's "finished setting up my identity,"
  not "claimed an invited crew spot," so it's deliberately not instrumented as
  `first_claim`.

## Product Metrics dashboard

The weekly funnel, the current activation rate, and the latest micro-feedback
responses are now surfaced directly in the PM dashboard (📊 Product Metrics,
super-admin only): a "Crew Activation Rate" KPI card, a "Crew Activation
Funnel" chart, and a "Recent Feedback" list
(`get_pm_dashboard_metrics()`, extended in
`supabase/migrations/20260812000000_pm_dashboard_crew_activation.sql`;
rendered in `app.html` via `renderPMDashBody()` /
`pmRenderActivationChart()` / `pmFeedbackRows()`). The standalone query below
still works and returns the same weekly shape, useful for ad hoc SQL-editor
checks.

## Querying the weekly funnel

`get_crew_activation_funnel()` (super-admin only, gated the same way as
`get_pm_dashboard_metrics()`) returns a JSONB weekly cohort funnel for the last 8 weeks:

```sql
select get_crew_activation_funnel();
```

```json
{
  "ok": true,
  "generated_at": "2026-08-09T12:00:00Z",
  "weekly": [
    {
      "week_start": "2026-07-27",
      "crews_created": 42,
      "reached_first_person_added": 30,
      "reached_first_event_added": 18,
      "activated": 15
    }
  ]
}
```

Each cohort is grouped by the week the crew was **created**, and each `reached_*`/
`activated` count reflects crews that hit that milestone within 7 days of their own
creation (not within 7 days of the cohort week).

## Micro-feedback responses

Separate from the counts above — this is **qualitative** signal. The first time a user
hits each of the same four activation moments (`crew_created`, `invite_sent`,
`claim_made`, `event_added`), a small floating card asks one rotating question
("What almost stopped you?" / "What would make you bring your full crew here?" /
"Anything confusing so far?") and, if they type something and hit Send, the response is
saved to `micro_feedback_responses`
(`supabase/migrations/20260811000000_micro_feedback_responses.sql`).

This is a **per-user, once-ever** ask, tracked client-side via
`user_metadata.feedback_prompts_shown` (same pattern as `seen_tips`/coachmarks) — not
the crew-scoped `(crew_id, event_name)` dedup the growth events above use. A user who
leads several crews is never asked the same milestone question twice. Dismissing without
typing anything ("Skip" or the ✕) marks the milestone as asked but writes no row.

**To review responses:** open the RaveFam Supabase project → Table Editor →
`micro_feedback_responses`, or run in the SQL editor:

```sql
select milestone, question, response, crew_id, created_at
from micro_feedback_responses
order by created_at desc;
```

Client-side: `maybeAskMicroFeedback(milestone, crewId)` (`app.html`, next to the NPS
prompt code) is called from the same four sites that already fire the analytics events
above — `createCrew()`, the invite-send call sites (QR modal's Copy link button,
`shareInviteLink()`, `generateAndShareCrewInvite()` — but not `showQRModal()`'s
modal-open, since merely displaying a QR isn't a completed "send"), `commitClaim()`
(after `showClaimSuccess()`), and `saveRave()`'s create branch.
