# Crew Feed: implementation plan

Replaces the crew detail page (Overview/Roster tabs + 8-tile grid) with the
Crew Feed design: `mockups/crew-feed-glass-ticket.html` (look) and
`mockups/crew-roster-access.html` option A (roster sheet).

## Decisions locked in

| Topic | Decision |
|---|---|
| Layout | Huddle pill, then the paper ticket, then filter chips, then one feed |
| Look | Aurora Glass feed, paper ticket for the countdown, paper cards for plan check-offs and badges |
| Roster | Avatars in the header open a "Crew Manifest" bottom sheet (option A). Overview/Roster tabs go away. |
| Several upcoming raves | Swipeable ticket stack, soonest first. The Plan filter follows the ticket you're on. |
| "Get settled" quests | Dropped from the crew page. Badges already earned stay. |
| Non-members | Preview: header, member count, blurred feed, Join / Request button |
| Extras at launch | Reply in Huddle from any card |
| Secret crews | No Polls/Jams filters or + options (same as today's hidden tiles) |
| Rollout | Behind a flag, off by default. The tile page stays as a fallback until the feed is the default. |

## Guiding approach: wrap, don't rewrite

The existing panels (`buildPollsHTML`, `buildJamsHTML`, `buildDreamBoardHTML`,
`buildArchiveHTML`, `buildCrewHistoryHTML`, `buildFamPinsHTML`, and the Rave
Plan via `openGamePlanTab`) already hold all create, edit, vote and filter
logic. Their `rerender*` functions patch element ids inside the
`crew-feature-panel-*` containers.

- **"All" filter:** a new merged feed of compact cards.
- **Every other filter:** shows the existing full panel for that feature, restyled with glass CSS. No logic changes.
- **Panel containers** stay in the DOM (hidden), exactly like today's `display:none` accordion. Every `rerender*` keeps working untouched.

This keeps the risky parts (voting, plan editing, uploads) on code that's
already tested.

## Code map (app.html)

| Area | Where | Change |
|---|---|---|
| `APP_VERSION` | ~10634 + `package.json` | 2.22.1 → **2.23.0** in PR 1 (minor: new feature behind a flag) |
| Flag | next to the Haptics setting (~11348) | `crewFeedEnabled()`: `localStorage ravefam_crew_feed === '1'`, per device. Settings hub gets a "New crew page (beta)" toggle. |
| `openDetail` | `// ===== Crew detail view =====` (~18648) | Deep links: `tab:'roster'` → `openCrewManifestSheet()`; `tab:'gameplan'` → `openCrewFeature('raveplan', {festivalId})`. Loader `.then`s also call `rerenderCrewFeed(id)`. |
| `renderDetail` | ~20112 | Just before the classic `innerHTML`: `if (crewFeedEnabled()) return renderCrewFeedPage(...)`. Overview HTML isn't built in feed mode. |
| Roster markup | inside `renderDetail` (`rosterPanelHTML`) | Reused as-is: the feed branch passes it into the sheet, so no extraction was needed |
| `toggleCrewFeatureTile` | ~20352 | Becomes the compatibility shim: in feed mode, forwards to `openCrewFeature(feature)` |
| Callers that look up `.crew-feature-tile[...]` and bail if it's missing | `openDetail` ~18690, Huddle activity links ~21618 / ~21629, jam tile ~23882, `crewQuestDefs` stamps | Switch to `openCrewFeature(feature, opts)`, which works in both modes |
| Unseen glow | `refreshCrewFeatureGlow` / `markCrewFeatureRead` (~20404) | Reused for "new since you looked" (see below). The glow is a no-op when there are no tiles, which is already safe. |
| Quests / zone intros | `crewQuestRowHTML`, `maybeOpenZoneIntro`, `zoneBadgeHTML` | Not called in feed mode. `markCrewQuest` calls stay harmless. |
| New section | after the Crew detail view block | `// ===== CREW FEED (new crew page) =====` with all the new functions below |
| New CSS | after `/* ===== CREW STATUS ZONE ... ===== */` (~4386) | `/* ===== CREW FEED ===== */`, scoped under `#page-crew-detail.crew-feed`, so the old page's styles are untouched |

### New functions (CREW FEED section)

- `renderCrewFeedPage(crew, …)`: page shell, called from the end of `renderDetail` so it reuses the roster markup `renderDetail` already builds (PR 3 adds the non-member preview)
- `crewFeedHeaderHTML(crew)`: ‹ back, totem, name, one-line description, status chip, avatar button "N ›", share icon (`openCrewShareCard`)
- `crewFeedHuddlePillHTML(crew)`: same data as `rerenderHuddleTilePreview` (last message, unread, here-now); taps `openHuddle`
- `crewTicketStackHTML(crew)`: one paper ticket per `deriveCrewFestivalPlans(crew).live`, horizontal scroll-snap, with the who's-going data from `crewNextFestBlock`. Empty state: "Where are we raving next?" → `switchTab('events')`
- `crewFeedFiltersHTML(crew)`: All · Polls · Jams · Dreams · Plan · Memories (Polls/Jams hidden for secret crews)
- `openCrewFeature(feature, opts)`: selects the matching filter, shows its panel, runs today's open-side effects (`openGamePlanTab`, `markCrewFeatureRead`), scrolls to `opts.id`
- `buildCrewFeedItems(crewId)`: merges the in-memory arrays `crewPolls`, `crewJams`, `dreamPins`, `archiveLinks`, `crewFeedEvents` (badges) and plan check-offs into `{kind, id, created_at, actor, ...}`, newest first
- `crewFeedCardHTML(item)` / `rerenderCrewFeed(crewId)`: compact cards. Actions call the existing handlers (vote, hype, jam react, open link). "Open" goes to `openCrewFeature`.
- `openCrewManifestSheet()` / `closeCrewManifestSheet()`: sheet over `buildCrewRosterHTML(crew)`; Escape and scrim close it; focus is trapped in the sheet
- `openCrewCreateMenu()`: + menu → `openCrewFeature(type)`, then focus that panel's existing create input
- `replyInHuddleFromCard(item)`: see PR 3

## "New since you looked"

Use the existing `crew_feature_reads` watermarks (`_crewFeatureReadMap`). On
open, snapshot the map, render the divider against the snapshot, then mark
every feature with new items read. The divider stays for this visit and is
gone next time. No schema change needed.

## Plan check-off cards need one migration

`game_plan_items` has `is_done` but no record of when it was done or by whom,
so "Jordan checked off Book the Airbnb" can't be built today.

- **Migration** `supabase/migrations/<date>_game_plan_item_done_meta.sql`: add `done_at timestamptz` and `done_by uuid references auth.users`, plus a `before update` trigger. It sets both from `now()` / `auth.uid()` when `is_done` flips to true and clears them when it flips back. Set by the trigger, not the client, so they can't be spoofed. No backfill: old check-offs just don't appear in the feed.
- **Load:** one crew-wide query, `game_plan_items` where `crew_id = ?`, `is_done`, `done_at` in the last 30 days (uses the existing `game_plan_items_crew_idx`). This is the feed's only new query.

## PR sequence

Each PR ships independently behind the flag.

**PR 1: Shell + roster sheet (flag, 2.23.0)**
- Flag + Settings toggle
- `renderCrewFeedPage`: header, Huddle pill, ticket stack, filters → existing panels (no merged feed yet; "All" shows the Polls, Dream Board and Jams panels stacked)
- Manifest sheet (reusing `rosterPanelHTML`), deep links, the `openCrewFeature` shim and its call sites
- Glass/aurora CSS with an `@supports not (backdrop-filter: blur(1px))` solid fallback, and `prefers-reduced-motion`

**PR 2: Merged feed (2.23.x)**
- `buildCrewFeedItems`, compact cards, "new since" divider, per-filter empty states, + menu
- Realtime: existing handlers (e.g. `handleCrewFeedRealtimeInsert`, poll/jam updates) call `rerenderCrewFeed` when on the feed page

**PR 3: Check-offs, Reply in Huddle, non-member preview (2.24.0)**
- Migration + check-off cards
- Reply in Huddle: open the Huddle with a quote chip in the composer (same slot `_huddleReplyTo` uses). The sent message carries a `link` (`{k:'tile', feature, id}`), so tapping it in the Huddle jumps back via `openHuddleActivityLink`.
- Non-member preview: skip the feature loaders in `openDetail` for non-members (RLS blocks them anyway; this saves the calls)

**PR 4: Default on, then cleanup (later)**
- Flip the default after a beta period; keep the toggle as an opt-out for one release
- Then delete the tile grid, Overview/Roster tabs, quest row and zone intros, and bump the version

## Tests

- **New:** `tests/crew_feed.spec.js`, run with `rf_crew_feed=1` set in localStorage. Covers:
  - header and sheet open/close, including Escape
  - filter → panel
  - ticket swipe → Plan filter follows
  - deep links (huddle / roster / gameplan)
  - secret crew hides Polls/Jams
  - non-member preview
- **Existing:** `crew_detail`, `crew_feature_glow`, `crew_vote`, `crews`, `history`, `huddle_chat`, `stats` and `venue_village` reference tiles or subtabs. They keep running with the flag off, unchanged, until PR 4.
- **Add the sheet to:** `escape_closes_overlays.spec.js` and `focus_containment.spec.js`

## To verify during PR 1/3 (not guessed)

1. Whether user Huddle messages may carry a `link` (today only `postHuddleSystemMessage` sets it). If RLS or the client blocks it, Reply in Huddle uses `reply_to`-style quote text only.
2. Whether poll voting and jam reactions have per-item functions that the compact cards can call, or need a small extraction from `buildPollsHTML` / `buildJamsHTML` (no behavior change).
3. What `rerenderHuddleTilePreview` reads, so the pill reuses it instead of re-querying.

## Not affected

- No native iOS changes, so no entry in `native/README.md`
- Notifications and the Huddle screen are unchanged except the link targets above
