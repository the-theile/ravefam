# Add Rave rebuild: build plan

Status: **plan only, nothing in `app.html` has changed.** Mockups: `mockups/add-rave-flow.html` (chosen flow), `mockups/add-rave-variations.html` (the A/B/C comparison).

Decisions so far (Nov 23 2026):
- One search-first sheet (variant A) with paste-a-link from variant B.
- Every new rave needs a name, a start date, and a place with a map pin (a venue or a pick from the location lookup).
- When adding from a raver's profile, the RSVP buttons are for that raver.
- Old raves missing a date or pin get an in-app "Fix" nudge for their creator or a moderator.
- The crew picker pre-selects the crew when the sheet is opened from that crew.
- Ships as **one MINOR release**: `2.51.0` → `2.52.0` (`APP_VERSION` + `package.json`).

---

## 1. Link test results (what a pasted link can fill in)

I fetched real event pages from this container with the `link-preview` function's user agent, and checked their Open Graph tags and JSON-LD `Event` data.

| Source | Result | Name | Date | Venue | Pin | Image |
|---|---|---|---|---|---|---|
| **Dice** event (3 tested) | 200 | ✅ JSON-LD `name` | ✅ `startDate` / `endDate` with timezone | ✅ `location.name` + street address | ✅ `geo` | ✅ og:image |
| **Eventbrite** event | 200 | ✅ | ✅ (also `event:start_time` meta) | ✅ name + city | ❌ no geo | ✅ |
| **Skiddle** listing | 200 | ✅ | ✅ | ✅ | ✅ geo | – |
| Festival sites (Awakenings, Dekmantel) | 200 | ⚠️ og:title only ("Dekmantel Festival - 2027") | ❌ | ❌ | ❌ | ✅ |
| **Resident Advisor** (ra.co) | **403** bot wall (DataDome) | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Instagram** post | **429**; the function already returns empty without the Meta token | ❌ | ❌ | ❌ | ❌ | ❌ |

On every page that has JSON-LD, it appears within the first 600 KB the function reads (offsets 3 KB–206 KB).

**What this means:**
- The current `link-preview` only returns `{title, description, image, site}`, so it can't fill dates or venues today.
- Adding a JSON-LD `Event` parser makes Dice, Eventbrite, Skiddle and most ticketing sites that use schema.org fill **name, date, days, venue and pin** completely.
- RA and Instagram won't work from the server. For those, fill nothing and save the URL as `ticket_url` (RA) or ignore it (Instagram), then show "Couldn't read this link, type the name instead".
- A festival homepage only gives the name: strip the trailing " - 2027" and " | Tickets" from the title.

## 2. Edge function change: `supabase/functions/link-preview/index.ts`

Add optional fields, so Huddle preview cards keep working unchanged:

```ts
type Preview = { url; title; description; image; site;
  event?: { name: string; start: string /* YYYY-MM-DD */; end?: string;
            venue?: string; locality?: string; country?: string;
            lat?: number; lng?: number } | null };
```

- New `jsonLdEvent(html)`: reads `<script type="application/ld+json">` blocks (including `@graph` and arrays) and takes the first item whose `@type` contains `Event` (`MusicEvent`, `Festival` etc.). It decodes HTML entities in `name`, and converts the local date out of `startDate` (keeping the date as written, ignoring timezone offsets).
- Called in `buildPreview` only on the generic HTML path, after `metaTags`. No extra fetch.
- Cache: rows already in `link_previews` don't have `event`. Add `?mode=rave` (or `body.wantEvent`), which skips the cache when the cached row has no `event` key. Huddle calls stay as they are.
- No new table, so no migration needed. Deploy with `deploy_edge_function`, which doesn't trigger the destructive-SQL approval prompt.

## 3. `app.html` changes

### Add (new section `// ===== ADD RAVE SHEET =====`, placed just above `// ===== Rave Focus popup` around L39436)
- `openAddRaveSheet(ctx)`, where `ctx = { raverId?, crewId?, source }`.
  - With no `raverId`, it's for you.
  - With `crewId`, that crew starts pre-selected.
- `renderAddRaveSearch(q)`: catalog search across `name`, `aliases`, `location` (normalised: lowercase, no punctuation or spaces). Sort upcoming first, then by FAM going. Past raves get a "Was there" button.
- `addRavePickExisting(festId)`: one tap. For you it calls `toggleGoingToFest`, or `addBeenTo` for a past rave. For a raver it calls `addBeenTo(raverId, festId)`, the same path `ifpAdd` uses today. Then it closes the sheet.
- `renderAddRaveCreate(prefill)`: the one-screen form, reusing the **existing** `renderFestVenuePicker()` and the `fe-loc` / `fe-lat` / `fe-lng` lookup (`locSearchDebounce`, `locKeydown`, `clearLocCoords`). It keeps the `fe-*` ids so those helpers work unchanged. Required-field checks run on input and disable the Add button.
- `addRavePasteLink(url)`: calls `link-preview` in rave mode and maps `event` into the prefill. If the fetch returned a pin, it skips the lookup.
- `likelyDuplicate({name, date, lat, lng, venueId})`: matches a similar name (normalised, or one contained in the other, or an alias) AND a date within ±1 day AND (the same `venue_id` OR within 25 km). Returns a festival or null. The 25 km uses the haversine helper already used by the miles stats (check its name when building).
- `createRave(data, ctx)`: the "new rave" half of today's `saveRave()` moved here, with three changes:
  - It notifies **only the selected crews**, using `notifyCrewMembers(crew, msg, links)`, instead of every crew you lead.
  - It sets the RSVP from the sheet (`toggleGoingToFest` / `toggleInterestedInFest`, or `addBeenTo` for a raver) instead of calling `promptGoingToNewRave`.
  - It writes `ticket_url` / `official_url` when present.
- `raveMissingDetailsHTML(f)`: the amber "Fix" bar. It shows only if `festivalPerms(f).canEdit && (!f.date || f.lat == null && !f.venueId)`. Tapping "Fix" opens `openRaveEditor(f.id)` on the right step (set `_raveEditStep` to `'basics'` or `'place'` first).
- CSS: one small block under `/* ===== Rave picker (new chip + search design) ===== */` (L2248), reusing `.fest-search-item`, `.fest-quick-chip` and the `.form-input` and `.btn` styles where possible.

### Change (surgical)
| Where | Now | After |
|---|---|---|
| L10097 Raves header button | `openRaveEditor()` | `openAddRaveSheet({source:'raves'})` |
| L39162 empty state CTA | `openRaveEditor()` | `openAddRaveSheet({source:'empty'})` |
| L35596 profile list sheet add button | `openNewRavePopup(r.id)` | `openAddRaveSheet({raverId:r.id})` |
| L37405 `renderFestPicker` (profile editor) | `openNewRavePopup('profile-editor')` | `openAddRaveSheet({raverId:'profile-editor'})`, keeping the `editingFestIds.add` + `renderFestPicker()` behaviour from `_nrpAddToContext` |
| L37678 `renderInlineFestPicker` | `openNewRavePopup(raverId)` | `openAddRaveSheet({raverId})` |
| L44859 Stats passport empty stamp | `openNewRavePopup(you.id)` | `openAddRaveSheet({raverId: you.id, source:'stats'})` |
| `openRaveEditor(id)` L39846 | handles both new and edit | Edit only. With no id it redirects to `openAddRaveSheet`, as a safety net for any call site I missed. |
| `saveRave()` L40723 | has a new-rave branch | Keep only the edit branch. The new branch moves to `createRave`. |
| `dbSaveFestival` L17188 | name/date/location/color/days/lat/lng/venue | Also writes `ticket_url`, `official_url` when given |
| Rave card render in `renderEvents` (L38884) | – | Add `raveMissingDetailsHTML(f)` to the card |

### Remove
- `#new-rave-popup-overlay` markup (L10476–10498).
- `openNewRavePopup`, `closeNewRavePopup`, `nrpNameSuggest`, `nrpPickExisting`, `saveNewRavePopup`, `_nrpAddToContext`, `_newRaveCtx` (L37557–37650).
- `promptGoingToNewRave` (L40829), unless something else calls it (grep first).
- `findFestivalByName` once `likelyDuplicate` replaces both of its callers. Grep for any other callers first.

### Leave alone
- The edit wizard steps (`RAVE_EDIT_STEPS`), Rave Focus, delete and archive, the moderator map tools.
- The `raver_festivals` DB trigger that notifies "you were added". It already covers the profile case.
- Quick-chip and search pickers in the profile editor (they add existing raves). Only their "+ Add new rave" button changes.

## 4. Shared state and call sites to check after editing
- `festivals` array: the temp id → real id swap and the re-push when `loadAllData` races the save. Keep that logic as it is in `createRave`.
- `editingFestivalId`, `activeFestId`, `editingVenueId`, `editRaveLastLocation`, `editRaveColor`: the sheet sets these while open (the location and venue helpers read them) and **must reset them on close**, or the next `openRaveEditor(id)` picks up stale values.
- The sheet reuses `fe-*` ids, so it must never be open at the same time as the wizard. `openAddRaveSheet` closes `rave-edit-overlay` first.
- Re-renders after an add: `renderSquad(); renderEvents(); renderCrews();`, plus `refreshProfileAfterRaveChange(raverId)` for the profile case (same as `_nrpAddToContext`).
- Analytics: keep `logAnalyticsEvent('first_event_added', …)` and `maybeAskMicroFeedback('event_added', …)`. Add `add_rave_sheet` events with `{source, path: 'existing'|'create'|'link', dupe_shown, dupe_used}` so we can measure the duplicate check.
- `blockedByRestriction('restrict_create')` is still enforced inside `dbSaveFestival`.
- Offline / logged out: today the profile popup falls back to `++festSeq` when there's no `currentUser`. Keep that fallback in `createRave`.

## 5. Tests
- Playwright (`tests/`): open from the Raves tab, search for an existing rave and RSVP. Create a new rave and check Add stays disabled until a lookup pick. Trigger the duplicate prompt with the same date and a nearby pin. Open from a profile and check the buttons read "<Name> is going" or "Was there". Check the Fix bar shows for the creator and is hidden for others.
- Edge function: unit-test `jsonLdEvent` against saved HTML from Dice, Eventbrite, a festival homepage, and an empty or bot-wall page.
- Manual: iOS app sheet height and keyboard on a small phone (the create form scrolls inside the sheet).

## 6. Open questions
1. **Crew pre-select needs an entry point.** No crew page has an "Add rave" button today. Add one to the crew detail page (e.g. next to the crew's upcoming raves), or only pre-select when there's a single crew?
2. **Optional database guard** for new rows: `check (date is not null and (venue_id is not null or (lat is not null and lng is not null))) not valid`. It's non-destructive, so it can go through `apply_migration`. Do it now, or wait until the UI has been live for a week?
3. **RA links:** save the pasted RA URL as `ticket_url` even though nothing else can be read from it?
