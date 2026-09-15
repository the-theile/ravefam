# RaveFAM beta QA — 2026-09-15 — APP_VERSION 1.50.1

## Environment

| | |
|---|---|
| Local app | `app.html` @ `claude/ravefam-beta-qa-3knvbj` (baseline 1.50.0 → shipped 1.50.1) |
| Playwright | `@playwright/test` 1.56.0, Chromium 1194, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` |
| Viewport | Desktop Chrome (Playwright default). **Mobile 390×844 not exercised** — see caveat below |
| Production DB | Supabase project `RaveFam` (`tvpgopciioqbqmjjjigh`), **read-only schema inspection only** |
| Live site | **Unreachable — see "Blocked on live"** |
| Accounts used | **None.** No credentials were supplied and no accounts were created |

### ⚠️ Blocked on live — read this first

**Journeys 1–7 were not executed against `https://myravefam.com`.** Two independent blockers:

1. **The brief's test-account block was left with empty placeholders** (`LEADER_EMAIL=`,
   `NEW_USER_A_EMAIL=`, `EXISTING_CLAIM_CODE=`, …). The brief says to stop and ask rather
   than improvise against a personal account.
2. **This sandbox has no egress to the live site.** The agent proxy denies `CONNECT` to
   `myravefam.com:443` with `403 connect_rejected` (organization network policy). Verified
   via `curl -sS "$HTTPS_PROXY/__agentproxy/status"`. Credentials alone would not have
   unblocked it — `cdn.jsdelivr.net` and every other non-allowlisted host are denied too.

So this pass is: **full offline Playwright suite + close static review of the claim /
join / signup / onboarding code paths + read-only inspection of the production
function definitions, grants and triggers** (via the Supabase MCP connector, which is
not affected by the HTTP egress policy).

Everything below labelled **CONFIRMED** was verified by executing code (Playwright) or by
reading the live function/trigger definition out of the production database. Everything
labelled **STATIC** is read from source and is *not* live-verified. Nothing here is
reported as live-tested.

No production rows were modified. No user data is reproduced in this report — the only
aggregates quoted are counts.

## Suite baseline

```
npm test  →  329 passed / 0 failed  (4.8m)   [before any change]
npm test  →  333 passed / 0 failed          [after fixes: 329 + 4 new]
npm run lint → app.html 0 errors, 82 warnings (all pre-existing no-unused-vars)
```

No pre-existing failures. The suite does not weaken any assertion in this change.

## Journey results

| # | Journey | Result | Notes |
|---|---|---|---|
| 1 | Marketing → app handoff | **Blocked (live)** | Static: all 8 landing CTAs point at `app.html?tab=login\|signup`; `?tab=` **is** correctly consumed at `app.html:9314` into `window._pendingAuthTab`. Landing QR path stashes `pendingClaimToken` + `openCodeEntry` (`index.html:848,939,943`) and the app consumes both (`app.html:10095,10026`). No defect found statically. |
| 2 | New user registration | **Blocked (live)** | Static review of `doSignup` / `showAuthTab` / onboarding v2 found no P0/P1. Handle rules enforced identically in both entry points (`validateHandleFormat`, `app.html:30124`); live availability-check-as-you-type already exists in **both** the handle picker and onboarding step 2 — the brief's "handle availability check" enhancement is already shipped. |
| 3 | Leader: Secret → people → event → invite | **Blocked (live)** / partial local | Invite generation covered by `tests/invites.spec.js` (QR code derivation, share sheet, crew `?join=` token persistence) — all pass. **Found BUG-3** (Locked In does not lock the roster). |
| 4 | Invite acceptance | **Blocked (live)** / partial local | The high-value area. **Found BUG-1, BUG-2, BUG-3, BUG-4, BUG-5, BUG-6.** Paths 1–14 could not be walked end-to-end; findings come from reading the client flow plus the live RPC definitions. |
| 5 | Post-join first session | **Blocked (live)** | Post-claim landing (`showClaimSuccess` → "View My Crews") and `runFirstTimeSetup` read as sensible. Not exercised. |
| 6 | Core loops | **Pass (local only)** | Raves/Ravers/Stats/Notifications/Huddle/Archive/Vendor/Venue/moderation/soft-delete all covered by existing specs, all green. |
| 7 | Client quality bar | **Partial pass** | Zero uncaught exceptions on boot signed-out and signed-in (CONFIRMED, `smoke`/`authed` specs). Escape-closes-overlays, focus containment, input labelling, colour-swatch a11y, keyboard reachability, iOS input zoom, XSS injection specs — all green. **Mobile 390×844, Android Chrome, desktop Safari and the camera QR path were not exercised** (Playwright config runs Desktop Chrome only). |

## Bugs (prioritized)

---

### BUG-1 — **P0** — `claim_and_merge_raver` performs no authorization on `p_existing_raver_id`

**Journey / surface:** 4 (invite acceptance) · production RPC `public.claim_and_merge_raver(text, uuid, jsonb)`

**Status:** CONFIRMED (live function definition read from production)

**Repro (not executed against production — do not run against prod):**
1. Obtain any valid unclaimed stub token `T`. Any received/forwarded invite link contains one; `?claim=T`.
2. Obtain any other raver's UUID `V` (crewmates can see these; they are returned by `get_crewmate_ravers`).
3. `POST /rest/v1/rpc/claim_and_merge_raver` with the **anon** key and
   `{"p_token":"T","p_existing_raver_id":"V","p_declined":{...}}`.

**Expected:** rejected — `p_existing_raver_id` is not the caller's profile, and the caller is not authenticated.

**Actual:** the merge branch runs in full, as `security definer` (RLS bypassed), and:
- repoints the stub's `crew_members` rows onto `V` — **forcing an arbitrary user into an arbitrary crew**;
- unions genres / `vibe_tags` / `custom_vibe_tags` into `V`'s row and backfills `V`'s empty `base`, `handle`, `instagram`;
- inserts festival RSVPs, interests and favourite artists for `V`;
- deletes `V`'s `raver_festival_interest` rows that overlap `raver_festivals`;
- awards PLUR points to `V`.

The merge branch never reads `auth.uid()` at all, so **an unauthenticated caller can do all of this** — `EXECUTE` is granted to `anon`.

**Suspected cause:** `claim_and_merge_raver`, merge branch (`if p_existing_raver_id is not null and p_existing_raver_id <> v_stub.id then …`). The repo's copy is `supabase/migrations/20260711000000_support_declined_items_on_direct_claim.sql`; production matches it.

**Fix shipped this session?** **Migration written, NOT applied** —
`supabase/migrations/20260915000000_harden_claim_flow.sql`. Adds an `auth.uid() is null`
guard and an ownership check (`exists (select 1 from ravers where id = p_existing_raver_id
and claimed_by = v_uid)`), and revokes `EXECUTE … from anon`.

**Residual risk:** the migration is unapplied, so **production is still exposed**. Applying
it is the single highest-priority action out of this pass. `revoke … from anon` is safe:
`commitClaim()` already returns early without `currentUser` (`app.html:10736`), so no
client path loses function.

---

### BUG-2 — **P0** — Stored XSS on the claim error screen via raver / claimer name

**Journey / surface:** 4 (invite acceptance) · `showScannerError('claimed', …)`, `app.html:10685`

**Status:** CONFIRMED (source; the injection point is unambiguous — raw interpolation into `innerHTML`)

**Repro:**
1. Attacker sets their own display name to `<img src=x onerror="/* payload */">` (free-text profile field).
2. Attacker claims any invite, becoming that stub's `claimer_name`. *(Or: a crew leader names an unclaimed stub with the payload — that becomes `raver_name`.)*
3. Anyone who afterwards scans that same QR / enters that same 6-char code gets the
   "This spot's taken" screen.

**Expected:** the name renders as inert text.

**Actual:** `desc` was built as
``` `<strong>${data?.raver_name || 'This profile'}</strong> has already been claimed${data?.claimer_name ? ' by ' + data.claimer_name : ''}…` ```
and assigned to `#error-body.innerHTML` — both names unescaped. Both originate as
user-typed free text and are returned verbatim by `get_claim_preview`'s `already_claimed`
branch.

This is the same class the repo has been closing for several releases (`b3e06b5`,
`d72b1ea`, `eabf4a5`, `be782b6`) — this call site was missed because the error screen is
only reachable on a *second* scan of an already-claimed code.

**Fix shipped this session?** **Yes** — `escHtml()` on both names, `app.html:10685`. APP_VERSION 1.50.1.

**Residual risk:** low. Sibling views in the same flow were audited: `showPreAuthIntercept`
uses `textContent`, `showClaimSuccess` / `showClaimPreview` already use `escHtml`. See
BUG-6 for the remaining `gradient` attribute-injection pattern, which is app-wide and not
fixed here.

---

### BUG-3 — **P1** — "Locked In" does not lock the roster; personal claim links stay live

**Journey / surface:** 3 & 4 · `showClaimPreview` (`app.html:10540`), `claim_and_merge_raver`

**Status:** CONFIRMED (client behaviour proven by new spec; server gap read from the live definition)

`app.html:14126-14129` states the contract:

```
//   'secret'    — private workspace for leader only; new crew default
//   'recruiting' — active; claimed members see each other; QR codes live
//   'locked-in'  — roster closed; no new members; QR disabled
```

Only the **crew `?join=` link** honours it — `canInvite` requires `status === 'recruiting'`
(`app.html:14569`) and `get_crew_by_invite_token` rejects non-recruiting crews server-side
(CONFIRMED from the live definition).

**Personal claim invites honour none of it.** `showQRModal`, `shareInviteLink` and
`openInvitePrompt` have no status check, and `claim_and_merge_raver` has no status check,
so a `?claim=` link or 6-char code still converts a member into a locked-in crew.

**Expected:** new claims into a locked-in crew are blocked, or explained.

**Actual (before fix):** the claim went through. Worse, the preview *displayed* the crew
as claimable while labelling it "🔒 Locked In".

**Fix shipped this session?** **Partially.**
- Client: `showClaimPreview` now replaces the claim CTA with an explanation for a locked-in
  crew, and `showScannerError` gained a `locked` view. Locked by
  `tests/claim_preview_status.spec.js`.
- Server: the authoritative gate is in the **unapplied** migration
  (`return jsonb_build_object('error','crew_locked_in')`), wired to the new client error view.

**Residual risk:** until the migration is applied the client gate is cosmetic — a stale tab
or a direct RPC call still claims into a locked crew.

---

### BUG-4 — **P1** — `find_raver_by_invite_code` resolves *claimed* ravers and returns an arbitrary row on collision

**Journey / surface:** 4, path 1/9 (typed code) · production RPC `public.find_raver_by_invite_code(p_code text)`

**Status:** CONFIRMED (live definition read from production)

```sql
SELECT qr_token FROM ravers
WHERE qr_token IS NOT NULL
  AND upper(left(replace(qr_token,'-',''),6)) = upper(p_code)
LIMIT 1;
```

`SECURITY DEFINER`, `EXECUTE` granted to `anon`, no rate limit. Two defects:

**(a) No unclaimed filter.** It matches *every* raver, claimed accounts included. The
6-char code is the first 6 hex chars of a UUID → a 16^6 ≈ 16.7M space searched against
**all** tokens, not just live invites. Production currently holds 41 tokens of which 24 are
unclaimed stubs, so widening the target set from 24 to 41 nearly doubles the hit rate for a
blind search. A hit on a *claimed* raver is then fed to `get_claim_preview`, whose
`already_claimed` branch returns that raver's **name** and their **claimer's name** — an
unauthenticated name-enumeration oracle.

**(b) `LIMIT 1` with no `ORDER BY` and no ambiguity guard.** Two ravers sharing a 6-char
prefix make the lookup non-deterministic — the code a leader reads aloud can resolve to a
*different* person's spot. Birthday-bound: harmless at 41 tokens (**0 collisions in
production today** — verified), ~1-in-2 odds of at least one collision pair by ~4,800
tokens. This is a latent correctness bug that arrives with growth.

**Expected:** only live invites resolve; an ambiguous code fails closed.

**Fix shipped this session?** **Migration written, NOT applied** — restricts to
`claimed_by is null and status = 'unclaimed'` and returns zero rows when the prefix matches
more than one stub.

**Residual risk:** even after the fix, 24 unclaimed stubs in a 16.7M space is ~700k
unthrottled guesses to hit one — minutes of scripted traffic. **Rate limiting is not
implemented and is not in the migration** (there is no generic per-caller throttle for anon
RPCs in this codebase; `enforce_destructive_action_rate_limit` only gates `deleted_at`
transitions). Recommended follow-ups, in order: (1) throttle `find_raver_by_invite_code`
per IP via `current_setting('request.headers')`; (2) lengthen the displayed invite code
beyond 6 chars; (3) expire stub tokens.

---

### BUG-5 — **P1** — Claiming collides with `crew_members_pkey` when the claimer is already in the crew

**Journey / surface:** 4, paths 12–13 (racing / leader claims own invite) · `claim_and_merge_raver` merge branch

**Status:** CONFIRMED (constraint + function definition both read from production)

`crew_members` has `PRIMARY KEY (crew_id, raver_id)` (verified). The merge branch runs:

```sql
update crew_members set raver_id = p_existing_raver_id where raver_id = v_stub.id;
```

If the claimer is **already a member of that crew**, this violates the PK, the exception
aborts the whole RPC, and the client falls through to `errType = 'unknown'` →
*"Something went wrong."*

Realistic triggers:
- The **leader claims an invite they created** (brief journey 4.13) — the leader is in their own crew.
- A member who joined by **`?join=` link** is later handed the **stub's QR** for the same crew — exactly the double-entry the "half-claimed raver rows" work (`f222802`) was about, arriving by a different route.

**Expected:** the stub merges into the existing member cleanly.

**Actual:** hard failure, useless message, stub stays `unclaimed` forever. No data loss —
the transaction rolls back — but the person is stuck and the roster keeps a ghost row.

**Fix shipped this session?** **Migration written, NOT applied** — deletes the stub's
membership of any crew the claimer already belongs to before repointing the rest.

**Residual risk:** unapplied. Note the deleted row's `added_at` / `added_by` are dropped in
favour of the claimer's existing membership; that is the correct precedence but does lose
the stub's original `added_at`.

---

### BUG-6 — **P2** — `gradient` is interpolated raw into `style="…"` attributes

**Journey / surface:** app-wide; reachable in the claim flow via `showClaimSuccess` / `showClaimPreview`

**Status:** STATIC (not proven exploitable end-to-end)

`safeColor()` (`app.html:25083`) validates hex colours, but there is **no `safeGradient()`**.
`raver.gradient` / `crew.gradient` go straight into style attributes in many places
(`raverAvatarHTML`, `crewTotemMarkHTML`, `showClaimSuccess`, `showClaimPreview`, …). A value
containing `"` would close the attribute.

In practice gradients are written from preset maps (`CREW_GRADIENTS`), so this needs a
crafted direct API write to `ravers.gradient` by someone whose RLS lets them update that row
(a stub's creator can). Reachable, but not through the UI.

**Fix shipped this session?** **No** — deliberately. This is an app-wide render pattern, and
fixing it properly means adding `safeGradient()` and threading it through every call site.
That is the drive-by refactor the brief rules out. Recommended as its own scoped change.

---

### BUG-7 — **P2** — "No account needed first" is not true

**Journey / surface:** 3 & 4 · `app.html:10176`, `9075`, `9102`

**Status:** CONFIRMED (source; the code path is explicit)

Three strings promise an account-free claim:

- `app.html:10176` — "they're added to your crew instantly. **No account needed first.**"
- `app.html:9075` — "you're added to the crew **instantly**"
- `app.html:9102` — "enter it below to **join instantly**"

But `handleClaimToken` (`app.html:10484`) branches on `if (!currentUser)` straight into
`showPreAuthIntercept`, whose copy reads *"Create an account or log in to claim it."*
An account is required first, always.

The brief calls this out by name ("'No account needed first' is either true or the UI stops
claiming it") and grades it P2 ("Copy lies").

**Fix shipped this session?** **No** — this is a founder's call between two valid fixes, and
the copy carries product voice I shouldn't unilaterally rewrite:
- **Cheap:** change the three strings (e.g. "→ they claim their spot in seconds").
- **Right:** build claim-first onboarding (Enhancement E1) and make the promise true.

---

### BUG-8 — **P2** — A declined claim re-prompts on every app open, forever

**Journey / surface:** 4 · `checkClaimParam` (`app.html:10094`), `processPendingClaim` (`app.html:10110`), `closeScanner` (`app.html:10241`)

**Status:** STATIC

`?claim=` is mirrored into **`localStorage.pendingClaimToken`**, which survives tab close and
browser restart. It is cleared in exactly three places: a successful `commitClaim()`, a
terminal `invalid_token` / `already_claimed` preview, and `doLogout()`.

Closing the preview with the ✕ (`closeScanner`) clears neither storage key — deliberately, per
the comment at `app.html:10113` ("clearing it here would lose the token if the user
accidentally closes the overlay"). The consequence is that a user who scans a code meant for
someone else, or simply decides not to join, gets the claim preview shoved in front of them on
**every single app open**, with no decline path short of logging out.

**Expected:** a way to say "not now" / "not me" that sticks.

**Fix shipped this session?** **No** — the current behaviour is an intentional trade-off and
the fix is a product decision. Suggested: treat a ✕ **from the preview view specifically** as a
deliberate decline (clear both keys) while keeping the token for closes from the scan view; or
keep a dismiss counter and stop re-prompting after 2.

---

### BUG-9 — **P2** — A `?join=` link to a non-recruiting crew pushes you through signup before saying no

**Journey / surface:** 4, path 10 (code for a Secret crew) · `app.html:10044`

**Status:** STATIC

On the signed-out screen the intercept overlay is opened **unconditionally**
(`document.getElementById('claim-intercept').classList.add('open')`) and only *populated* if
`get_crew_by_invite_token` succeeds. For a Secret or Locked-In crew the RPC returns
`not_recruiting`, so the overlay stays up showing the generic baked-in "You've been invited!"
copy. The user signs up, and only after `bootApp()` does `processPendingCrewJoin` toast
*"⚠️ … isn't currently recruiting."*

It fails closed (no membership granted) — so this is friction, not a security bug — but it
spends a whole signup to deliver a rejection. For the `?claim=` path this is an explicit
choice (`app.html:10039-10043`, "signup is open to everyone now"); for `?join=` the rejection
is knowable before signup.

**Fix shipped this session?** **No.** Suggested: on `not_recruiting`, replace the intercept
body with the crew name and "this crew isn't taking new members right now" before the signup
form is offered.

---

## Fixes shipped

**APP_VERSION 1.50.0 → 1.50.1** (PATCH — bug fixes). `package.json` bumped in sync.

| Change | File | Bug |
|---|---|---|
| `escHtml()` on `raver_name` / `claimer_name` in the claim error screen | `app.html:10685` | BUG-2 (P0) |
| Claim preview reports the crew's real status via `STATUS` instead of collapsing everything non-`locked-in` to "Recruiting" | `app.html:10552` | BUG-3 |
| Locked-in crew: claim CTA replaced with an explanation instead of a button the server would reject | `app.html:10643-10648` | BUG-3 |
| New `locked` error view + `crew_locked_in` error mapping in `commitClaim` | `app.html:10696-10703`, `10789` | BUG-3 |
| 4 new specs covering Secret / Recruiting / Locked-In / missing-crew previews | `tests/claim_preview_status.spec.js` | BUG-3 |

**Migration written but deliberately NOT applied** —
`supabase/migrations/20260915000000_harden_claim_flow.sql` (BUG-1, BUG-3 server gate,
BUG-4, BUG-5). Per the brief, migrations are not applied to production without
confirmation. **This needs an explicit decision — BUG-1 is a live P0.**

Verification: `npm test` → 333 passed / 0 failed. `npm run lint` → `app.html` 0 errors
(82 pre-existing warnings, unchanged).

## Enhancements (prioritized)

| # | Problem → Suggestion | Why it moves the funnel | Effort |
|---|---|---|---|
| **E1** | The claim flow promises "no account needed first" and then hard-stops at an auth wall (BUG-7). → **Claim-first onboarding:** code/QR → crew preview → *then* create the account, carrying the pending claim (the plumbing already exists: `pendingClaim` survives the round trip, and `get_claim_preview` is already `anon`-callable). | Time-to-first-claim. This is the single biggest drop in the joiner funnel and the only enhancement that makes existing copy true. | **M** |
| **E2** | A brand-new leader lands on Crews with a headline and a `+` card (`app.html:15254`) and no sequence. → After creating a Secret crew, show a 4-step checklist: add 3 people · pick 1 rave · flip to Recruiting · share. | Time-to-first-crew, and it maps 1:1 onto the `crew_created → first_person_added → first_event_added → first_invite_sent` funnel in `ANALYTICS.md`, so it is directly measurable. | **M** |
| **E3** | `?claim=` / `?join=` opened logged-out shows a generic intercept, not the crew. → Populate the intercept with crew name, totem, member count and the next rave *before* the auth form. `get_crew_by_invite_token` already returns `totem_photo_url` and `member_count` and neither is used. | Time-to-first-claim + trust. Near-zero cost: the data is already on the wire. | **S** |
| **E4** | Unclaimed vs claimed roster rows are not clearly distinguished for the leader. → An explicit "hasn't joined yet" pill with a one-tap re-invite. | Time-to-first-claim; gives the leader a reason to return and chase. | **S** |
| **E5** | Camera denial drops to the code tab after a 400ms delay (`app.html:10322`) with the deep link lost. → On denial, offer the claim link directly as a tappable fallback. | Time-to-first-claim on iOS, where camera denial is common. | **S** |
| **E6** | The 6-char invite code is a UUID prefix — short, collision-prone and enumerable (BUG-4). → Move to an 8-char Crockford base32 code from a dedicated column. | Trust; also retires BUG-4(b) permanently rather than papering over it. | **M** |

Explicitly **not** recommended, per the brief's guardrails: no native app, no public social
graph, no ads, nothing that weakens Secret-first.

## Funnel observation

Where a new crew would stall, against `ANALYTICS.md`'s
`crew_created → first_person_added → first_event_added → (first_invite_sent | first_claim | first_rsvp_updated)`:

- **create → add person:** likely fine. Crew creation supports bulk-add, and the crew-pick →
  invite-prompt chain fires automatically after each add. Both `dbAddCrewMember` and
  `dbSaveCrewMembers` are instrumented.
- **add person → add event:** **the weakest instrumented step, and it is partly a measurement
  artifact.** `ANALYTICS.md` already documents that `first_event_added` attributes to *every*
  crew the actor leads, because `festivals` has no `crew_id` and "Add Rave" is launched from
  the global Events tab with no crew context. A leader who adds a rave from inside crew detail
  has no path that carries the crew. Expect this step to look both *worse* than reality (no
  in-crew entry point) and *noisier* (fan-out across led crews).
- **add event → invite:** the mechanics are sound and three separate call sites are
  instrumented — but this is where BUG-7 bites. The leader shares a link promising "no account
  needed", and the joiner hits an auth wall. **Invites sent will outrun claims**, and the gap
  will read as joiner disinterest when it is actually the auth wall.
- **invite → claim:** highest-risk leg. BUG-5 hard-fails the two most likely early claims (the
  leader testing their own invite; a member who already joined by `?join=`), and the user-facing
  message is *"Something went wrong."* A founder self-testing the flow is **more** likely to hit
  BUG-5 than a stranger is, so this can read as "the whole claim flow is broken."
- **claim → RSVP:** untested (blocked on live). `showClaimSuccess` routes to "View My Crews"
  rather than to the crew's next rave, which is one more tap than needed before the
  `first_rsvp_updated` event can fire.

## Open questions for the founder

1. **Apply `20260915000000_harden_claim_flow.sql`?** BUG-1 is a live P0 and the migration is
   the fix. It also changes two error paths (`not_your_profile`, `crew_locked_in`) and revokes
   `anon` EXECUTE on `claim_and_merge_raver`. I have not applied it.
2. **Should a `?claim=` link work while the crew is still Secret?** Today it does. The brief's
   lifecycle says invites go live at Recruiting; `app.html:14126-14129` says "QR codes live" at
   recruiting. But the invite prompt fires *immediately* after adding a person — which happens in
   Secret, since crews are created Secret. So the code and the UX disagree. I fixed **Locked In**
   (unambiguous: "roster closed") and deliberately left **Secret** alone. Which is intended?
3. **BUG-7: change the copy, or build claim-first onboarding (E1)?** I did not touch the copy —
   it carries product voice and the answer depends on whether E1 is on the roadmap.
4. **`get_claim_preview` returns `notes` to `anon`.** The claim preview shows it as "Your leader
   added these details for you", but the profile UI describes a raver's own notes as *"a secret
   only you can read"* (`app.html:25675`), and the test harness masks `notes` to self-or-unclaimed
   with no moderator bypass. Exposure is **bounded to unclaimed stubs** — `get_claim_preview`
   returns only `{error, raver_name, claimer_name}` once a raver is claimed — so this is a
   narrower leak than it first looks, and it matches product intent for the real invitee. It is
   only wrong for someone who *brute-forced* a stub token (BUG-4). Leave as-is, or drop `notes`
   from the anon payload?
5. **Do you want a live pass at all?** It needs both the test-account block filled in **and** an
   environment with egress to `myravefam.com`. This sandbox has neither. Journeys 1–5 remain
   genuinely untested — in particular the two the brief ranks highest, live registration and live
   claim.
6. **Mobile was not exercised.** `playwright.config.js` defines a single Desktop Chrome project.
   Worth adding a 390×844 project so `ios_input_zoom.spec.js` and the bottom-nav/home-indicator
   checks actually run at phone width?
