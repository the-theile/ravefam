# RaveFAM beta QA — 2026-09-15 — APP_VERSION 1.52.0

> A formatted, filterable version of this report is published as a private artifact:
> https://claude.ai/artifact/7sJGRvwM8o3g3ETZ5tPgyK
> This file stays the source of truth; the page mirrors it.

## Environment

| | |
|---|---|
| Local app | `app.html` @ `claude/ravefam-beta-qa-3knvbj` (baseline 1.50.0 → shipped 1.52.0) |
| Playwright | `@playwright/test` 1.56.0, Chromium 1194, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` |
| Viewport | Desktop Chrome **and iPhone 13 (390×844, DPR 3, touch)** via the new `mobile-chromium` project. Real WebKit is configured but unavailable here — see "Mobile & iOS coverage" |
| Production DB | Supabase project `RaveFam` (`tvpgopciioqbqmjjjigh`). Read-only inspection, **plus the hardening migration applied on request** (see Fixes shipped) |
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
join / signup / onboarding code paths + inspection of the production function definitions,
grants and triggers** (via the Supabase MCP connector, which is not affected by the HTTP
egress policy).

That inspection started read-only. Later in the session, **on explicit request, the hardening
migration was applied to production** — see "Fixes shipped". That is the only write this
session made to production, and it changed function definitions and one grant, not data.

Everything below labelled **CONFIRMED** was verified by executing code (Playwright) or by
reading the live function/trigger definition out of the production database. Everything
labelled **STATIC** is read from source and is *not* live-verified. Nothing here is
reported as live-tested.

**No production rows were read out or modified.** The applied migration is DDL only. The
post-apply smoke checks used deliberately bogus tokens and returned before any write
statement. No user data is reproduced in this report — the only production figures quoted are
aggregate counts (41 tokens, 24 unclaimed stubs, 0 colliding prefixes).

## Suite baseline

```
npm test  →  329 passed / 0 failed  (4.8m)   [baseline, before any change]
npm test  →  399 passed / 0 failed  (5.9m)   [final: 352 desktop + 47 mobile]
npm run lint → app.html 0 errors, 82 warnings (all pre-existing no-unused-vars)
```

32 specs added across 6 new files — 23 visible to the desktop project (329 + 23 = 352) and
9 phone-only. The mobile project re-runs 9 layout/touch-sensitive spec files at iPhone 13
metrics rather than the whole suite — see "Mobile & iOS coverage".

No pre-existing failures. The suite does not weaken any assertion in this change.

## Journey results

| # | Journey | Result | Notes |
|---|---|---|---|
| 1 | Marketing → app handoff | **Blocked (live)** | Static: all 8 landing CTAs point at `app.html?tab=login\|signup`; `?tab=` **is** correctly consumed at `app.html:9314` into `window._pendingAuthTab`. Landing QR path stashes `pendingClaimToken` + `openCodeEntry` (`index.html:848,939,943`) and the app consumes both (`app.html:10095,10026`). No defect found statically. |
| 2 | New user registration | **Blocked (live)** | Static review of `doSignup` / `showAuthTab` / onboarding v2 found no P0/P1. Handle rules enforced identically in both entry points (`validateHandleFormat`, `app.html:30124`); live availability-check-as-you-type already exists in **both** the handle picker and onboarding step 2 — the brief's "handle availability check" enhancement is already shipped. |
| 3 | Leader: Secret → people → event → invite | **Blocked (live)** / partial local | Invite generation covered by `tests/invites.spec.js` (QR code derivation, share sheet, crew `?join=` token persistence) — all pass. **Found BUG-3** (Locked In does not lock the roster) and **BUG-10** (a Secret crew prompts to invite). |
| 4 | Invite acceptance | **Blocked (live)** / partial local | The high-value area. **Found BUG-1, BUG-2, BUG-3, BUG-4, BUG-5, BUG-6, BUG-8, BUG-9.** Paths 1–14 could not be walked end-to-end; findings come from reading the client flow plus the live RPC definitions. |
| 5 | Post-join first session | **Blocked (live)** | Post-claim landing (`showClaimSuccess` → "View My Crews") and `runFirstTimeSetup` read as sensible. Not exercised. |
| 6 | Core loops | **Pass (local only)** | Raves/Ravers/Stats/Notifications/Huddle/Archive/Vendor/Venue/moderation/soft-delete all covered by existing specs, all green. |
| 7 | Client quality bar | **Partial pass** | Zero uncaught exceptions on boot signed-out and signed-in (CONFIRMED, `smoke`/`authed` specs). Escape-closes-overlays, focus containment, input labelling, colour-swatch a11y, keyboard reachability, iOS input zoom, XSS injection specs — all green. **Mobile 390×844 is now exercised** by the `mobile-chromium` project (9 new layout specs; found BUG-11). Still not exercised: **real Mobile Safari / WebKit** (binary unavailable here), Android Chrome, desktop Safari, and the camera QR path. |

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

**Fix shipped this session?** **Yes — applied to production 2026-09-15.**
`supabase/migrations/20260915000000_harden_claim_flow.sql`. Adds an `auth.uid() is null`
guard and an ownership check (`exists (select 1 from ravers where id = p_existing_raver_id
and claimed_by = v_uid)`), and revokes `EXECUTE … from anon`.

Verified live after applying:
- `exec_grants` on `claim_and_merge_raver` is now `{authenticated, postgres, service_role}` — **`anon` is gone**.
- Calling it with no JWT returns `{"error":"not_authenticated"}` (guard fires before the row lock, zero writes).
- Calling it with a JWT and a bogus token returns `{"error":"invalid_or_used_token"}` — the normal path is intact.

**Residual risk:** low. `revoke … from anon` is safe because `commitClaim()` already returned
early without `currentUser`. An authenticated attacker can no longer target another raver's
row, but can still burn an invite they legitimately hold — that is inherent to invite links.

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

**Fix shipped this session?** **Yes, both layers.**
- Client: `showClaimPreview` replaces the claim CTA with an explanation for a locked-in crew,
  and `showScannerError` gained a `locked` view. Locked by `tests/claim_preview_status.spec.js`.
- Server: **applied to production** — `claim_and_merge_raver` returns
  `{"error":"crew_locked_in"}`, wired to the client error view.

**Residual risk:** none for Locked In. **Secret** is deliberately still claimable — see open
question 2.

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

**Fix shipped this session?** **Yes — applied to production 2026-09-15.** Restricts to
`claimed_by is null and status = 'unclaimed'` and returns zero rows when the prefix matches
more than one stub.

Verified live after applying: a claimed raver's 6-char code now returns **0 rows** (was 1),
a real unclaimed stub's code still returns **1** (invites keep working), and a garbage code
returns 0. 17 of the 41 tokens in production are no longer resolvable by code at all.

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

**Fix shipped this session?** **Yes — applied to production 2026-09-15.** Deletes the stub's
membership of any crew the claimer already belongs to before repointing the rest.

**Residual risk:** the deleted row's `added_at` / `added_by` are dropped in favour of the
claimer's existing membership. That is the correct precedence, but it does lose the stub's
original `added_at` — a crew's "member since" for that person becomes the earlier of the two,
not the stub's date.

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

**Fix shipped this session?** **Yes.** My first read called this an app-wide refactor; that
was an overestimate — it is ~20 sinks, and chasing sinks was the wrong shape anyway.

`safeGradient(v, fallback)` now sits beside `safeColor()` and accepts only
`linear-/radial-gradient(...)` over a character class that cannot close an attribute. It is
applied **at the data boundary** in `loadAllData()` (both raver load paths and the crew path),
so every downstream sink is safe by construction — including the ones that reach it through
intermediate variables (`m.c`, `avatarBg`, `dividerBg`), which a sink-by-sink pass missed and
the test caught. The ~20 direct interpolations are wrapped too, as belt-and-braces.

The default is a string literal, not a module `const`: `safeGradient()` is called from
`loadAllData()`, and a `const` declared later in the file would be in its temporal dead zone
there and throw, breaking the entire data load.

Covered by `tests/gradient_injection.spec.js` (5 specs: accepts every real gradient shape,
rejects attribute-breaking input, and a hostile crew/raver/stub gradient renders inert).

---

### BUG-7 — **P2** — "No account needed" is true in two places and false in a third

**Journey / surface:** 3 & 4 · see the table below

**Status:** CONFIRMED (source; auth-free surfaces verified by absence of any auth code)

RaveFAM makes the "no account" promise on **three different surfaces**. Two are accurate and
should be left exactly as they are. Only the scan/claim surface overstates it.

| Surface | Claim | Verdict |
|---|---|---|
| **Lineup Explorer** — `lineup-explorer/index.html:50,304,1058`, `og-image-source.html:144` | "free, with no account or login required" | ✅ **True.** The directory and all 34 festival pages contain zero Supabase and zero auth code — the only matches for `supabase\|auth\|login` in the whole directory are the two copy strings themselves. |
| **Landing page, Lineup Explorer section** — `index.html:653` | "Free for the fam · no account" | ✅ **True.** Scoped inside the `<!-- LINEUP EXPLORER -->` section, next to "no login, no wall." |
| **Adding crewmates (leader-facing)** — `app.html:8716` | "Add ravers you already know as unclaimed profiles… **no account needed for them yet** — to track your whole fam before anyone's even signed up" | ✅ **True, and precisely worded.** "for them" and "yet" both do real work. This is the product thesis and it holds. |
| **Scan / claim flow** — 6 strings, below | "no account needed first" / "added to the crew **instantly**" | ❌ **Overstated.** |

The six strings that overstate it:

| Line | Audience | Current text |
|---|---|---|
| `app.html:8110` | claimer (signed-out splash) | "Got a crew invite? Scan the QR code — **no account needed first**" |
| `app.html:10176` | **leader** (`showQRModal` hint) | "they're added to your crew instantly. **No account needed first.**" |
| `app.html:9075` | claimer (scanner subtitle, static) | "you're added to the crew **instantly**" |
| `app.html:10273` | claimer (same subtitle, set by `switchScannerTab`) | same |
| `app.html:9102` | claimer (code-entry hint, static) | "enter it below to **join instantly**" |
| `app.html:10278` | claimer (same hint, set by `switchScannerTab`) | "Type it in — you're added to the crew instantly" |
| `index.html:46`, `:731` | claimer (FAQ **and** schema.org FAQPage) | "Scan a QR code or enter a 6-digit claim code to join an existing crew **instantly**" |

`handleClaimToken` (`app.html:10484`) branches on `if (!currentUser)` straight into
`showPreAuthIntercept`, whose own copy reads *"Create an account or log in to claim it."*
So for a signed-out scanner an account is required first, always.

Two nuances that shape the fix:

1. **`app.html:10176` is leader-facing, not claimer-facing.** It sits inside the QR modal the
   *leader* is holding up. The true statement there is the one at `app.html:8716` — the leader
   didn't need the invitee to have an account in order to build the roster. As written it reads
   as a promise about the scanner instead.
2. **The claimer-facing strings are conditionally true.** If the scanner is already signed in
   (the scanner is reachable from inside the app), the claim really is instant. Only the
   signed-out case is wrong — and `switchScannerTab` already sets both strings dynamically, so
   they can simply branch on `currentUser`.

The `index.html` FAQ copy is duplicated into `schema.org` `FAQPage` markup, so it can surface
in Google results — worth correcting alongside.

**Fix shipped this session?** **Yes — all six strings, approved wording.** The Lineup Explorer
and "adding crewmates" claims were left untouched, as they are accurate. The two claimer-facing
strings now branch on `currentUser` in `switchScannerTab()`, so a signed-in scanner still reads
"you're added to the crew instantly" (true for them) and only a signed-out one is told about the
signup step. Verified afterwards that no "no account needed first" / "join … instantly" string
survives in `app.html` or `index.html`, and that all three accurate claims still do.

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

**Fix shipped this session?** **Yes.** `closeScanner()` now distinguishes *which view* it is
closing from. Closing the **preview** is a decision — the user has seen whose spot it is and
chose not to take it — so both storage keys are cleared and a toast acknowledges it. Closing
from the **scan** view, or from an **error** view, is just backing out and keeps the token, so
a network blip never burns someone's invite.

Covered by `tests/claim_dismissal.spec.js` (4 specs, including both keep-the-token cases).

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

**Fix shipped this session?** **Yes.** `showJoinNotRecruiting()` repoints the intercept at
"*Bass Syndicate* isn't recruiting right now 🤫" (or "This invite link has expired" for an
unknown token) and clears the pending token, since there is no join to complete after signup.
Signup stays reachable underneath — a closed link is no reason to bar the door.

This is safe to do for `?join=` precisely because the rejection is knowable pre-auth:
`get_crew_by_invite_token` is `anon`-callable and returns `not_recruiting` with the crew name.
The `?claim=` path deliberately keeps its optimistic intercept.

Required a harness addition: `get_crew_by_invite_token` is now stubbed in `tests/helpers.js`,
mirroring the production function. Covered by `tests/join_link_preauth.spec.js` (5 specs).

---

---

### BUG-10 — **P1** — A Secret crew prompts the leader to invite, breaking the Secret promise

**Journey / surface:** 3 (leader path) · `maybeOfferInvite` / `closeCrewPickAndProfile`, `app.html:24459`

**Status:** CONFIRMED (fixed + covered by new specs)

Crews are created **Secret**, and the onboarding copy promises *"Nothing is sent or notified
while you're Secret"* (`app.html:8716`). But adding a person to a Secret crew fired the invite
prompt — *"Invite Sam now? · Show QR & code · Send a link"* — immediately, pushing the leader
toward an action the Secret stage is supposed to defer.

`saveCrewPick()` already respects Secret for the activity feed
(`if (crew.status !== 'secret') postCrewActivity(...)`), so the crew-status check existed one
line away and simply wasn't applied to the invite prompt.

**Expected:** building a Secret roster stays silent. Invites become a thing when the leader
opens the crew to Recruiting.

**Actual (before fix):** the prompt fired on every add, in every crew status.

**Fix shipped this session?** **Yes.** New `raverInviteIsLive(raverId)` gates both entry
points: the prompt appears only when the raver is in at least one `recruiting` crew. Secret
and Locked In instead show a toast that names the reason and points at the next step
("Invites go live when you open the crew to Recruiting"). A raver in **no** crew keeps the old
behaviour — there is no crew status to respect, and they're still a blackbook contact worth
inviting.

Deliberately **not** gated: the 📲 button on a raver's profile still opens the QR in Secret. A
leader who wants to pre-share can; the change is that the app no longer *pushes* it.

**Residual risk:** none for the prompt. The underlying claim link still works in Secret — see
open question 2.

---

### BUG-11 — **P2** — The mobile bottom nav ignores the iOS home-indicator safe area

**Journey / surface:** 7 (client quality bar), iOS · `nav` and `main` under `@media (max-width: 640px)`, `app.html:262`

**Status:** CONFIRMED (found by the new mobile pass; fixed + regression-tested)

On phones the tab bar is `position: fixed; bottom: 0` with `padding: 0` and **no
`env(safe-area-inset-bottom)`**. On any iPhone with a home indicator the tab row renders
inside the ~34px strip iOS reserves for the swipe bar, so the bottom of every tap target is
fouled and the nav reads as sitting under the system UI. `main`'s `padding-bottom: 90px`
had the same problem — it stops clearing the nav once the nav grows by the inset.

This is a gap rather than an oversight in principle: the huddle composer (`app.html:4115`)
and the notification drawer footer (`app.html:3293`) both already handle the inset. The
primary nav — the one control on every single screen — was the one that didn't.

**Fix shipped this session?** **Yes.** `padding: 0 0 env(safe-area-inset-bottom, 0px)` on the
nav, and `calc(90px + env(safe-area-inset-bottom, 0px))` on `main`.

**Note on the test:** `env(safe-area-inset-*)` resolves to `0` in a headless browser with no
notch, so a computed-style assertion cannot tell "handled" from "forgotten". The spec asserts
against the CSSOM rule text instead. I verified it genuinely fails by reverting the fix and
re-running — it does.

## Fixes shipped

**APP_VERSION 1.50.0 → 1.52.0**, `package.json` in sync. 1.50.1 (PATCH, claim-screen
fixes) → 1.51.0 (MINOR, Secret invite-prompt behaviour change) → 1.52.0 (MINOR, approved copy
changes, three P2 fixes, and the iOS safe-area fix).

| Change | File | Bug |
|---|---|---|
| `escHtml()` on `raver_name` / `claimer_name` in the claim error screen | `app.html:10685` | BUG-2 (P0) |
| Claim preview reports the crew's real status via `STATUS` instead of collapsing everything non-`locked-in` to "Recruiting" | `app.html:10552` | BUG-3 |
| Locked-in crew: claim CTA replaced with an explanation instead of a button the server would reject | `app.html:10643-10648` | BUG-3 |
| New `locked` error view + `crew_locked_in` error mapping in `commitClaim` | `app.html:10696-10703`, `10789` | BUG-3 |
| 4 new specs covering Secret / Recruiting / Locked-In / missing-crew previews | `tests/claim_preview_status.spec.js` | BUG-3 |
| `raverInviteIsLive()` gates the invite prompt to Recruiting crews; Secret/Locked In get an explanatory toast | `app.html:24459-24484`, `24448` | BUG-10 |
| 5 new specs covering the invite prompt across Secret / Recruiting / Locked In / crewless / multi-crew | `tests/invite_prompt_crew_status.spec.js` | BUG-10 |
| All six overstated "no account / instantly" strings rewritten; the two claimer-facing ones now branch on `currentUser` | `app.html:8110,9075,9102,10176`, `switchScannerTab()`; `index.html:46,731` | BUG-7 |
| `safeGradient()` added beside `safeColor()`, applied at the `loadAllData()` boundary + ~20 sinks | `app.html:25135`, `11324`, `11384`, `11428` | BUG-6 |
| Closing the claim **preview** now clears the pending token (scan/error closes keep it) | `closeScanner()`, `app.html:10247` | BUG-8 |
| `showJoinNotRecruiting()` — a `?join=` link to a Secret/Locked In/unknown crew says so before signup | `app.html:10047-10082` | BUG-9 |
| Mobile bottom nav + `main` reserve `env(safe-area-inset-bottom)` | `app.html:262`, `310` | BUG-11 |
| `mobile-chromium` project (iPhone 13 metrics) + auto-detected `mobile-safari` (real WebKit) | `playwright.config.js` | iOS coverage |
| 9 phone-width layout specs: no h-scroll, safe areas, nav pinning, tap targets, signed-out screens | `tests/mobile_layout.spec.js` | BUG-11 |
| 5 gradient-injection specs | `tests/gradient_injection.spec.js` | BUG-6 |
| 4 claim-dismissal specs | `tests/claim_dismissal.spec.js` | BUG-8 |
| 5 pre-auth `?join=` specs + `get_crew_by_invite_token` added to the stub | `tests/join_link_preauth.spec.js`, `tests/helpers.js` | BUG-9 |
| **Migration APPLIED to production** (was written-not-applied) | `supabase/migrations/20260915000000_harden_claim_flow.sql` | BUG-1, 3, 4, 5 |

**The hardening migration was applied to production on request**, after capturing the prior
definitions for rollback (`scratchpad/ROLLBACK_NOTES.md`; the `claim_and_merge_raver` pre-state
is byte-identical to `20260711000000_support_declined_items_on_direct_claim.sql`). Post-apply
verification is recorded under BUG-1 and BUG-4. The smoke checks used bogus tokens and returned
before any write statement, so no production rows were touched.

Verification: `npm test` → 333 passed / 0 failed. `npm run lint` → `app.html` 0 errors
(82 pre-existing warnings, unchanged).

## Mobile & iOS coverage

**Correction to an earlier claim in this report:** I previously wrote that
`ios_input_zoom.spec.js` "never actually runs at phone width." That was wrong. It sets its own
iPhone 13 viewport via `test.use({ viewport, isMobile, hasTouch })` and always has — its header
comment explains the deliberate choice to borrow the iPhone viewport but *not* its
`defaultBrowserType`, because the CSS floor it guards keys off `(hover: none) and
(pointer: coarse)`, which `isMobile`/`hasTouch` drive on Chromium. The real gap was that
**every other spec ran at 1280px only**, so nothing watched phone-width layout.

`playwright.config.js` now defines three projects:

| Project | Engine | Scope |
|---|---|---|
| `chromium` | Desktop Chrome | everything except `mobile_layout.spec.js` |
| `mobile-chromium` | Chromium at iPhone 13 metrics (390×844, DPR 3, touch, mobile UA) | 9 layout/touch-sensitive specs |
| `mobile-safari` | **real WebKit**, iPhone 13 | same 9 specs — **added only when the WebKit binary is present** |

Re-running all ~350 specs at phone width would double the suite for little signal, so the
mobile projects run a curated list (`MOBILE_SPECS`): the phone-only layout spec, the iOS zoom
spec, boot/auth/onboarding, both claim-flow specs, and the two overlay-behaviour specs — the
screens a new user actually meets on a phone, which is how most people arrive.

### The WebKit caveat — this is the honest limit

**Real Mobile Safari was not exercised.** WebKit is not installed in this sandbox and
`npx playwright install webkit` fails (`Download failure` — the same egress policy that blocks
the live site). `mobile-chromium` gives iPhone *metrics* on Chromium: it catches layout,
viewport, touch-media-query and tap-target regressions, but **not** WebKit rendering
differences, real iOS Safari input-zoom behaviour, `-webkit-` prefix gaps, or the camera/QR
permission path.

The `mobile-safari` project is written and will activate itself the moment the binary exists —
`webkitAvailable()` probes `PLAYWRIGHT_BROWSERS_PATH` (or `~/.cache/ms-playwright`) and adds the
project only if a `webkit*` directory is there. So on your Mac, or in CI with network access:

```bash
npx playwright install webkit
npm test          # now runs chromium + mobile-chromium + mobile-safari
```

No config change needed. On a machine without it the suite still runs and simply skips the
WebKit pass rather than failing to start.

## Copy changes — BUG-7 (approved and shipped in 1.52.0)

**Out of scope — do not touch.** These are accurate and stay exactly as written:
`lineup-explorer/index.html:50,304,1058`, `lineup-explorer/og-image-source.html:144`,
`index.html:653`, `app.html:8716`.

**In scope.** Two principles: (a) the claimer-facing strings branch on `currentUser`, because
"instantly" is genuinely true for a signed-in scanner and only wrong when signed out;
(b) the one leader-facing string stops describing the scanner's experience and describes what
the leader actually did.

| # | Line | Current | Proposed |
|---|---|---|---|
| C1 | `app.html:8110` (signed-out splash) | "Got a crew invite? Scan the QR code — no account needed first" | "Got a crew invite? Scan the QR code — see your crew before you sign up" |
| C2 | `app.html:10176` (**leader**, QR modal hint) | "Show this QR or share the code — they're added to your crew instantly. No account needed first." | "Show this QR or share the code — their spot's already built, they just claim it. You never needed their account to get this far." |
| C3 | `app.html:9075` + `10273` (scanner subtitle) | "…— you're added to the crew instantly." | *signed in:* unchanged — "…— you're added to the crew instantly."<br>*signed out:* "…— see who you're joining, then finish signing up to claim your spot." |
| C4 | `app.html:9102` + `10278` (code-entry hint) | "enter it below to join instantly" / "Type it in — you're added to the crew instantly" | *signed in:* unchanged.<br>*signed out:* "Type it in — see the crew, then finish signing up to claim your spot." |
| C5 | `index.html:46` + `:731` (FAQ **and** schema.org `FAQPage`) | "…enter a 6-digit claim code to join an existing crew instantly." | "…enter a 6-digit claim code to see the crew straight away, then create your free account to claim your spot." |

C3/C4 need a small change in `switchScannerTab` (`app.html:10270-10280`), which already sets
both strings dynamically — so this is a `currentUser ? … : …` on two existing assignments,
plus updating the two static defaults in the markup to the signed-out variant.

C1's "see your crew before you sign up" is accurate: `showPreAuthIntercept` renders the crew
name, colour and the raver's avatar before any auth, powered by `get_claim_preview`'s `anon`
grant (which the hardening migration deliberately preserves).

**If Enhancement E1 (claim-first onboarding) ships instead, C1–C5 become unnecessary** — the
original copy would simply become true. These changes are the cheap path, not the good one.

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

## How to actually get a live pass

Journeys 1-5 against `myravefam.com` are still the big hole. Two things are missing and they
are independent — fixing one without the other does not unblock it.

**Blocker A — network.** This sandbox's egress policy denies `CONNECT` to everything outside a
small allowlist (npm, PyPI, the Anthropic API). `myravefam.com`, `cdn.jsdelivr.net` and the
Playwright browser CDN are all refused with `403 connect_rejected`. Notably the **Supabase MCP
connector is not affected** — it is how the production findings in this report were confirmed
and how the migration was applied. So "no network" is really "no *HTTP* egress"; the database
is reachable.

**Blocker B — credentials.** The test-account block in the brief is still empty.

### Options, roughly best to worst

| Option | What it unblocks | Effort | Catch |
|---|---|---|---|
| **1. Run the suite against live from your own machine** | Everything. Full journeys 1-5 in a real browser on a real network. | **S** | Needs the test accounts created and the env block filled in. This is the one I'd pick. |
| **2. GitHub Actions workflow with repo secrets** | Journeys 1-5 on every push, plus WebKit (runners can install it). | **M** | Secrets for the beta accounts; a live-hitting job should be manual-dispatch or nightly, never on every PR. |
| **3. Allowlist the hosts on this environment** | Live HTTP from sessions like this one. | **S** (for whoever owns the policy) | **Not changeable from inside a session** — it's the environment's network policy, set where the environment is configured, and a session only picks it up on a fresh start. Still needs credentials. See the host list below. |
| **4. Point the existing offline suite at a Supabase branch** | Real RPCs, real RLS, real claim/merge — no stubs — without touching production data. | **M** | Supabase branching is available on this project. Catches everything the stub can't model (RLS, triggers, the claim RPC's real behaviour). Does **not** cover the live CDN, service worker, or PWA install. |
| **5. Me driving live through a browser-automation MCP** | Journeys 1-5 from here. | **M** | Only if such a connector is attached *and* it is not behind the same egress policy. It is not attached today. |

### If you allowlist, allowlist these

The egress policy is enforced at the gateway, upstream of the session's local proxy — a session
cannot widen it, and the proxy's own README says to report a 403 rather than route around it
(`/root/.ccr/README.md`, "403 / 407 from the proxy"). It is set on the **environment**, and a
running session does not pick up a change: start a new session after editing it. Configuration
and the available policies are documented at
<https://code.claude.com/docs/en/claude-code-on-the-web>.

`myravefam.com` alone would load the page but leave it broken — the app pulls from several
hosts. Worth adding together:

| Host | Why |
|---|---|
| `myravefam.com` | The live site itself |
| `tvpgopciioqbqmjjjigh.supabase.co` | The backend — without it the app boots to a dead shell |
| `cdn.jsdelivr.net` | Chart.js, html2canvas, eruda |
| `fonts.googleapis.com`, `fonts.gstatic.com` | Webfonts; absence changes layout metrics |
| `tile.openstreetmap.org`, `nominatim.openstreetmap.org` | Radar map tiles and location autocomplete |
| `api.open-meteo.com`, `geocoding-api.open-meteo.com` | Rave weather |
| Playwright's browser CDN | Only if you want **WebKit** installed here rather than on your own machine |

The first two are the minimum for any live journey. The rest decide whether you are testing the
real app or a degraded one — and a degraded one will generate false findings.

### What I'd actually do

**Option 1 for the immediate gap, option 4 as the durable fix.** Option 1 answers "does the
real thing work" once. Option 4 is what stops this class of bug recurring: every P0 in this
report lived in a Postgres function that the offline stub re-implements *by hand* in
`tests/helpers.js`. A hand-written stub can never catch a bug in the thing it is imitating —
`claim_and_merge_raver` had no authorization check for months and no test could have found it,
because the stub's version was a different piece of code with different logic.

Running the same specs against a real Supabase branch closes that gap permanently.

### Fastest concrete path

1. Create three throwaway accounts on live (leader + two joiners), fill in the brief's env block.
2. `npx playwright install webkit` on your machine — that alone activates the `mobile-safari`
   project and gives you real iOS Safari coverage on the next `npm test`.
3. Walk journeys 2 and 4 by hand once, on an actual phone. Record the claim code, `?claim=` URL
   and `?join=` URL. Those two journeys are where every P0 and P1 in this report lived.
4. If you want it repeatable, wire option 2 or 4.

## Open questions for the founder

1. ~~Apply the hardening migration?~~ ✅ **Done** — applied to production 2026-09-15 and
   verified live (see BUG-1 / BUG-4). Rollback notes captured.
2. **Should a `?claim=` link still *work* while the crew is Secret?** ✅ *Confirmed as-is.*
   You said that's fine. A claim link already handed out still resolves into a Secret crew;
   only **Locked In** is gated. Recorded so the next person doesn't "fix" it.
3. ~~BUG-7 copy?~~ ✅ **Done** — approved wording shipped for all six strings; the Lineup
   Explorer and "adding crewmates" claims left untouched.
4. ~~Should `get_claim_preview` keep returning `notes` to `anon`?~~ ✅ **Resolved — leave as
   is.** Recorded so it isn't re-litigated: the payload is only built for **unclaimed stubs**
   (a claimed raver returns just `{error, raver_name, claimer_name}`), and since BUG-4 was fixed
   a stranger can no longer turn a guessed code into a claimed account's token. So `notes`
   reaches only someone holding a real invite link — which is exactly who the claim preview's
   "your leader added these details for you" line is written for. The residual tension is
   cosmetic: the profile UI describes a raver's *own* notes as "a secret only you can read",
   which reads oddly next to a leader-written note on a stub. No code change.

5. **Rate limiting on `find_raver_by_invite_code`.** Still unthrottled. 24 live stubs in a 16^6
   space is ~700k unthrottled guesses to hit one — minutes of scripted traffic. Worth doing
   before the crew count grows. Cheapest real fix is a longer invite code (Enhancement E6);
   a per-IP throttle via `current_setting('request.headers')` is the other option.
6. **Real Mobile Safari is still unexercised** — WebKit can't be installed here. The project is
   configured and self-activating; `npx playwright install webkit` on any machine with network
   turns it on. See "Mobile & iOS coverage".
7. **Live journeys 1-5 remain untested.** See "How to actually get a live pass" — my
   recommendation is a manual pass from your machine now, and Supabase-branch testing as the
   durable fix, since every P0 here lived in a Postgres function the offline stub only imitates.
