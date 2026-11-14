# RaveFAM `app.html` map

Snapshot of `app.html` at **APP_VERSION 2.40.0** (45,223 lines, 2.37 MB raw, about 580 KB gzipped).
Line ranges drift with every edit. The `// ===== SECTION =====` header text is the stable anchor: search for it rather than trusting a line number.

The catalogue in section C and the indexes in section D were extracted mechanically (top-level `function` declarations, `.from('…')`, `.rpc('…')`). Calls built from a variable (for example `sb.from(tableName)` in the Jams reaction helper) are not picked up, so treat the indexes as a floor, not a guarantee.

## A. File layout

| Lines | What |
|---|---|
| 1–60 | `<head>`: meta/OG tags, Google Fonts, platform flags (`is-android`, `is-native-app`, `is-ios-web`), blocking `supabase-js@2.117.3` from jsDelivr, deferred `qrcode.min.js`, html2canvas, cropperjs |
| 61–9644 | One `<style>` block: neon theme tokens, layout, modals, sheets, Huddle, responsive rules |
| 9645–9720 | `<body>` opens: SVG icon sprite and boot loader markup (`#app-loading`) |
| 9721–9746 | Standalone boot-loader script (status line, Retry after 10 s). Runs even if the main script throws |
| 9747–11282 | Static HTML shell: auth screen, `#main-app`, tab pages, modals, overlays |
| 11283–45147 | The main `<script>` (everything in section C) |
| 45148–45218 | Trailing script: Ko-fi support widget |
| 45219–45221 | Vercel analytics/speed-insights, eruda init |

Other files that matter at runtime: `sw.js` (service worker), `vercel.json` (rewrites for `/app?join=`, `/app?claim=`, `/rave/:slug`, `/countdown/:token`), `api/*.js` (OG images, public rave page, countdown page, Telegram webhook), `lineup-explorer/` (separate static pages sharing localStorage with the app), `supabase/functions/*` (edge functions), `capacitor.config.json` (iOS shell loads `https://myravefam.com/app`).

## B. How the app hangs together

### Global state (all plain globals in the main script)

| Global | Declared | Holds | Filled by |
|---|---|---|---|
| `currentUser` | SUPABASE INIT | Supabase auth user | `showApp` / `showAuthScreen` |
| `_bootedUserId` | PERMISSION HELPERS | guard so `bootApp` runs once per user | `onAuthStateChange` |
| `squad` | Festivals catalog (L34095) | every raver the user can see: own profile (`isYou`), stubs they created, crewmates (`readOnly: true`) | `loadAllData` via `get_own_and_created_ravers` + `get_crewmate_ravers` |
| `crews` | Crew data model (L18092) | crews visible under RLS, each with `squadIds`, `isLead`, `leader_id` (a raver id), `memberSince` | `loadAllData` (`crews` + embedded `crew_members`) |
| `festivals` | Festivals catalog (L34056) | every non-deleted rave in the catalog | `loadAllData` |
| `huddleRooms`, `huddleMessages`, `_huddleActiveCrewId`, `_huddleActiveRoomId` | HUDDLE | the one open Huddle room | `openHuddle` → `switchHuddleRoom`, realtime |
| `gamePlans`, `_gamePlanActive*` | Crew detail view | Rave Plans for the open crew | GAME PLAN loaders |
| `_mb` | MISSION BRIEFING | state of the open briefing, incl. its realtime channel | MISSION BRIEFING |
| `dreamPins`, `archiveLinks`, `crewPolls`, `crewPollVotes`, `crewJams`, `crewJamVibes`, `crewAchievements`, `raverAchievements`, `crewFeedEvents` | Crew detail view | per-crew content for the open crew | `dbLoadDreamPins`, `dbLoadArchiveLinks`, `dbLoadPolls`, `dbLoadJams`, `dbLoadAchievements` |
| `activeDetailId` | Crew detail view | id of the crew whose detail page is open | `openDetail` |
| `_notifications` | ONBOARDING v2 (L41565) | bell drawer items | `dbLoadNotifications` |
| `nicknameCache`, `festVibesCache`, `metStoriesCache`, `ourPhotosCache` | various | per-raver / per-fest caches | background loads in `loadAllData` |
| `vendors`, `venues`, `artists` (+ appearances, sightings, plans) | various | catalogs | lazy / background loads |
| `moderatorIds`, `isSuperAdminUser` | SUPABASE INIT | role gates (UI only; RLS is the real gate) | `dbLoadModerators`, `dbLoadSuperAdmin` |
| `_guidance`, `_feedbackPrompts*` | SUPABASE INIT | mirrors of `auth.users.user_metadata` | `showApp`, `saveGuidance` |
| `isOnboarding` | ONBOARDING | true while the first-run wizard is up | ONBOARDING v2 |

`squad`, `crews` and `festivals` are `const` arrays that are emptied in place (`.length = 0`) and refilled by `loadAllData`. Nearly every render function reads them directly.

### Boot sequence

1. Parse time: `sb = supabase.createClient(...)`, pageview RPC, error listeners, `checkClaimParam()` stashes `?claim=` (session + localStorage), `?join=` (sessionStorage only), `?rave=`, `?picks=`, `?invite=`.
2. `sb.auth.onAuthStateChange` → `showApp(user)` or `showAuthScreen()`.
3. `showApp` → `bootApp()`:
   `loadAllData()` → `processPendingClaim()` → `processPendingCrewJoin()` → `renderSquad/renderCrews/renderEvents` → `dbLoadNotifications` → `setupRealtimeSync()` → native push init → deep link / share inbox → `initRealms()` → `runFirstTimeSetup()` (onboarding wizard, handle picker, or welcome popup).
4. `loadAllData()` runs again after most membership changes (10 call sites) and 800 ms after any realtime event on `crew_members`, `crews` or `raver_festivals`.

### Realtime channels

| Channel | Set up in | Listens to | Torn down |
|---|---|---|---|
| `app-live` | `setupRealtimeSync` | `postgres_changes` on `crew_members`, `crews`, `raver_festivals` (→ full `loadAllData`), `notifications`, `huddle_messages` INSERT, `point_events` INSERT, `crew_feed_events`, `crew_archive_links` | `showAuthScreen` |
| `crew-presence:<crewId>` (one per crew) | `syncCrewPresenceChannels` (called by `renderCrews`) | presence | when the crew leaves `crews`; `teardownCrewPresence` on sign-out |
| `huddle:<crewId>:<roomId>` | `subscribeHuddleRealtime` | `huddle_messages` INSERT/UPDATE for the room | `teardownHuddleLive` (room switch / close) |
| `huddle-presence:<roomId>` | `trackHuddlePresence` | presence + `typing` broadcast | `teardownHuddleLive` |
| `crew-plan-<crewId>` | CREW FEED (L22636) | Rave Plan check-offs | L22643 |
| `mission-briefing-<gamePlanId>` | MISSION BRIEFING (L27778) | game plan changes | L27691 |

None of the `postgres_changes` subscriptions pass a status callback, and nothing re-fetches on reconnect or when the tab becomes visible again.

### Storage buckets

| Bucket | Public | Used for | Path shape |
|---|---|---|---|
| `photos` | yes | avatars, crew totems, "our photos", vendor photos | `profiles/<raverId>.jpg`, `crews/<crewId>.jpg`, `our-photos/<a>_<b>_<uid>.jpg`, `vendors/<vendorId>` |
| `huddle-media` | yes | Huddle photos and voice notes | `crews/<crewId>/<roomId>/<uuid>.jpg` |
| `huddle-gifs` | yes | moderator-curated GIF pack | — |
| `festival-maps` | yes | rave maps (moderators upload) | — |
| `support-screenshots` | no | Contact us attachments | `<uid>/…` |
| `profile-pics`, `festival-memories` | yes | no write policy and no code path found; look unused | — |

### Edge functions (Supabase) and Vercel functions

`link-preview`, `giphy-proxy`, `fetch-playlist-meta` are called from the client. `send-beacon-email`, `send-beacon-push`, `send-mention-push`, `send-support-email` are fired by database triggers via `pg_net`. `send-drip-emails`, `send-lifecycle-emails`, `send-lineup-alerts`, `send-set-reminders` run on `pg_cron`. `resend-webhook` receives Resend events. Vercel: `api/invite-og.js`, `api/rave-og.js`, `api/rave.js`, `api/countdown.js`, `api/telegram.js`.

### Service worker (`sw.js`)

Cache `ravefam-v10`. Precaches `/`, `/app.html`, `/qrcode.min.js`, `/manifest.json`. HTML is network-first with cache fallback (no timeout). Same-origin static assets are cache-first. Anything on `supabase.co`, hosts starting `cdn.` or `fonts.`, Turnstile, Nominatim and Open-Meteo bypass the worker entirely, so `supabase-js` (jsDelivr) and Google Fonts are never cached by it. Also handles `push` and `notificationclick`.

## C. Section catalogue

Each entry: header text, line range, top-level functions (first 16), module-level state declared in the section, and the Supabase surface it calls directly.

Three headers undersell what sits under them, because later code was added without a new header:

- **"Lineup Explorer picks handoff" (L13582–15362)** also holds the whole claim flow (`processPendingClaim`, `processPendingCrewJoin`, QR modal, scanner and code entry, `showClaimPreview`, `commitClaim`), `setupRealtimeSync`, the PLUR tier celebration, `bootApp`, `runFirstTimeSetup` and `loadAllData`.
- **"PHOTO HELPERS" (L16709–18076)** also holds profile photo and crew totem upload, "our photos", private phones, nicknames, viewer notes and `disconnectRaver`.
- **"NPS PROMPT" (L42980–43714)** also holds the leaderboard (`get_leaderboard`, `get_my_rank`).

### 1. Boot, auth and platform shell

#### (script start: boot, error reporting, globals)  
`L11283–11296` (14 lines, 0 functions)

- **Module-level state/consts declared here:** `APP_VERSION`

#### SUPABASE INIT  
`L11297–11417` (121 lines, 9 functions)

- **Functions:** `getVisitorId`, `getUtmParams`, `logClientError`, `logAnalyticsEvent`, `logSignupCompletedIfNew`, `defaultGuidance`, `saveGuidance`, `dbLoadModerators`, `isModerator`
- **Module-level state/consts declared here:** `SUPA_URL`, `SUPA_KEY`, `VAPID_PUBLIC_KEY`, `_seenErrors`, `currentUser`, `_feedbackPromptsShown`, `_feedbackPromptsQueued`, `_guidance`, `moderatorIds`
- **Tables / buckets (`.from`)**: `moderators`
- **RPCs:** `log_pageview`, `log_client_error`, `log_analytics_event`

#### PM METRICS DASHBOARD: super-admin gate  
`L11418–11430` (13 lines, 2 functions)

- **Functions:** `dbLoadSuperAdmin`, `updatePMDashBadge`
- **Module-level state/consts declared here:** `isSuperAdminUser`
- **RPCs:** `is_super_admin`

#### Admin tools menu: lives inside the ❔ help button so mods/admins  
`L11431–11459` (29 lines, 5 functions)

- **Functions:** `onAppGuideBtnClick`, `updateAdminMenuVisibility`, `toggleAdminMenu`, `closeAdminMenu`, `_onAdminMenuOutside`

#### BLOCKING: one raver blocks another  
`L11460–11576` (117 lines, 10 functions)

- **Functions:** `isBlockedUser`, `blockedRaverName`, `dbLoadUserBlocks`, `dbBlockUser`, `dbUnblockUser`, `confirmBlockUser`, `toggleBlockFromProfile`, `sync`, `refreshBlockedViews`, `renderBlockedRaversSettings`
- **Module-level state/consts declared here:** `_blockedUids`
- **Tables / buckets (`.from`)**: `user_blocks`

#### MODERATION: PLUR Code  
`L11577–11594` (18 lines, 0 functions)

- **Module-level state/consts declared here:** `PLUR_CODE`

#### MODERATION: flags/reports data layer  
`L11595–11738` (144 lines, 13 functions)

- **Functions:** `dbSubmitFlag`, `dbLoadFlags`, `modRpcError`, `dbModResolveFlag`, `dbResolveFlag`, `dbDismissFlag`, `dbLoadFlagContext`, `dbIssueSanction`, `dbRevokeSanction`, `updateModBadge`, `displayName`, `raverByAuthUid`, `raverIsClaimed`
- **Module-level state/consts declared here:** `openFlagCount`, `MOD_RPC_ERRORS`, `modFlagContext`, `privatePhoneCache`, `nicknameCache`, `festVibesCache`
- **Tables / buckets (`.from`)**: `flags`
- **RPCs:** `mod_resolve_flag`, `mod_flag_context`, `mod_issue_sanction`, `mod_revoke_sanction`

#### PERMISSION HELPERS  
`L11739–11924` (186 lines, 6 functions)

- **Functions:** `raverPerms`, `none`, `festivalPerms`, `crewPerms`, `none`, `ownerOrManager`
- **Module-level state/consts declared here:** `_bootedUserId`

#### AUTH UI helpers  
`L11925–11986` (62 lines, 8 functions)

- **Functions:** `showAuthTab`, `saveLastLogin`, `readLastLogin`, `authError`, `authSuccess`, `clearAuthMessages`, `setAuthFocusMode`, `setAuthBusy`
- **Module-level state/consts declared here:** `AUTH_BUSY_LABELS`

#### PASSWORDLESS AUTH (email code + magic link)  
`L11987–12006` (20 lines, 1 functions)

- **Functions:** `authRedirectUrl`
- **Module-level state/consts declared here:** `_otpEmail`, `_otpResendTimer`, `OTP_RESEND_COOLDOWN`

#### IOS APP STORE NUDGE  
`L12007–12033` (27 lines, 1 functions)

- **Functions:** `dismissIosAppBanner`
- **Module-level state/consts declared here:** `IOS_APP_BANNER_KEY`

#### NATIVE APP (Capacitor iOS shell)  
`L12034–12110` (77 lines, 8 functions)

- **Functions:** `hapticsEnabled`, `crewFeedEnabled`, `nativeHaptics`, `hapticImpact`, `hapticSuccess`, `hapticError`, `shareRaveFam`, `openNativeAppUrl`
- **Module-level state/consts declared here:** `IS_NATIVE_APP`, `HAPTICS_OFF_KEY`, `CREW_FEED_KEY`

#### NATIVE SHARE INBOX (iOS share sheet)  
`L12111–12222` (112 lines, 6 functions)

- **Functions:** `shareInboxPlugin`, `shareInboxMessageText`, `checkShareInbox`, `openShareInboxPicker`, `closeShareInboxPicker`, `pickShareInboxTarget`
- **Module-level state/consts declared here:** `SHARE_INBOX_MAX_AGE_MS`, `_shareInboxReady`, `_shareInboxBusy`, `_shareInboxText`, `_shareInboxNoCrewAt`

#### NATIVE COUNTDOWN WIDGET (iOS home/lock screen)  
`L12223–12290` (68 lines, 4 functions)

- **Functions:** `countdownWidgetPlugin`, `forgetCountdownWidgetToken`, `syncCountdownWidget`, `clearCountdownWidget`
- **Module-level state/consts declared here:** `COUNTDOWN_WIDGET_TOKEN_KEY`, `COUNTDOWN_WIDGET_MIN_GAP_MS`, `_countdownWidgetSyncedAt`, `_countdownWidgetBusy`
- **RPCs:** `create_countdown_link`, `get_countdown`

#### NATIVE PUSH (iOS app)  
`L12291–12439` (149 lines, 10 functions)

- **Functions:** `nativePushPlugin`, `saveNativePushToken`, `openFromNativePush`, `registerNativePush`, `ensureNativePush`, `enableAllNativePushTypes`, `maybeOfferNativePush`, `initNativePushAfterLogin`, `syncNativeAppBadge`, `forgetNativePushToken`
- **Module-level state/consts declared here:** `NATIVE_PUSH_OFFERED_KEY`, `_nativePushToken`, `_nativePushWaiter`, `_nativeBadgeCount`
- **Tables / buckets (`.from`)**: `email_preferences`, `alert_preferences`, `device_push_tokens`
- **RPCs:** `register_device_push_token`

#### ANDROID BETA WAITLIST  
`L12440–12594` (155 lines, 11 functions)

- **Functions:** `abetaDismissed`, `abetaSetDismissed`, `loadAndroidBetaState`, `foundingTesterBadgeHTML`, `renderAndroidBetaCard`, `openAndroidBetaForm`, `closeAndroidBetaForm`, `dismissAndroidBetaCard`, `openAndroidBetaFromSettings`, `submitAndroidBeta`, `leaveAndroidBeta`
- **Module-level state/consts declared here:** `IS_ANDROID_WEB`, `ABETA_DISMISS_KEY`, `_abetaState`, `_abetaOpen`, `foundingTesterIds`
- **RPCs:** `get_founding_testers`, `my_android_beta`, `join_android_beta`, `leave_android_beta`

#### CAPTCHA (Cloudflare Turnstile)  
`L12595–12823` (229 lines, 19 functions)

- **Functions:** `initCaptcha`, `getCaptchaToken`, `isCaptchaError`, `sendLoginCode`, `showCodeScreen`, `startResendCooldown`, `tick`, `otpErrorMessage`, `parseLoginId`, `onLoginIdInput`, `loginIdError`, `clearLoginIdError`, `initAuthAgree`, `onAuthAgreeChange`, `requireAuthAgree`, `doLogin`, … +3 more
- **Module-level state/consts declared here:** `TURNSTILE_SITE_KEY`, `TURNSTILE_JS`, `CAPTCHA_WAIT_MS`, `_captchaWidget`, `_captchaToken`, `_captchaWaiters`, `CAPTCHA_ERROR_MSG`, `AUTH_AGREE_KEY`, `_otpResendInFlight`

#### SMS AUTH (phone code via Supabase + Twilio Verify)  
`L12824–12965` (142 lines, 11 functions)

- **Functions:** `normalizePhone`, `formatPhoneDisplay`, `showSmsCodeScreen`, `startSmsResendCooldown`, `tick`, `smsErrorMessage`, `sendSmsCode`, `doSendSmsCode`, `doResendSmsCode`, `onSmsCodeInput`, `doVerifySmsCode`
- **Module-level state/consts declared here:** `_smsPhone`, `_smsSentAt`, `_smsInFlight`, `_smsResendTimer`, `SMS_CODE_TTL_MS`

#### LOGIN METHOD LINKING (second way in for the signed-in account)  
`L12966–13245` (280 lines, 27 functions)

- **Functions:** `missingLoginMethod`, `loginMethodLabel`, `userPhoneE164`, `userPhoneDisplay`, `guessOwnPhone`, `openLinkMethodModal`, `closeLinkMethodModal`, `linkError`, `renderLinkEntry`, `renderLinkCode`, `linkChangeValue`, `startLinkCooldown`, `tick`, `linkErrorMessage`, `linkRequest`, `linkSendCode`, … +11 more
- **Module-level state/consts declared here:** `PENDING_LINK_KEY`, `PENDING_LINK_TTL_MS`, `EMAIL_CODE_TTL_MS`, `_link`


### 2. App shell, claim flow and data loading

#### LAZY VENDOR LOADING  
`L13246–13304` (59 lines, 5 functions)

- **Functions:** `loadScriptOnce`, `loadStylesheetOnce`, `loadJsQR`, `loadLeaflet`, `addBasemapTiles`
- **Module-level state/consts declared here:** `_lazyAssets`, `LEAFLET_JS`, `LEAFLET_CSS`, `ERUDA_JS`, `BASEMAP_TILES`

#### APP SHOW / HIDE  
`L13305–13479` (175 lines, 6 functions)

- **Functions:** `maybeInitEruda`, `toggleErudaVisibility`, `showApp`, `showAuthScreen`, `showJoinNotRecruiting`, `showClaimLinkDead`
- **Module-level state/consts declared here:** `ERUDA_ALLOWED_EMAILS`, `_erudaInited`
- **RPCs:** `get_claim_preview`, `get_crew_by_invite_token`

#### AUTH STATE LISTENER  
`L13480–13515` (36 lines, 0 functions)


#### QR Claim flow  
`L13520–13581` (62 lines, 2 functions)

- **Functions:** `processPendingRave`, `processPendingInvite`

#### Lineup Explorer picks handoff  
`L13582–15362` (1781 lines, 70 functions)

- **Functions:** `picksSplitKeys`, `readBrowserPicks`, `processPendingPicks`, `picksHandoffCount`, `renderPicksHandoffChoices`, `picksHandoffChoose`, `closePicksHandoff`, `picksHandoffRsvp`, `savePicksHandoff`, `renderPicksHandoffSetsIn`, `sharePicksWithCrew`, `renderPicksHandoffCrew`, `picksHandoffStartCrew`, `picksHandoffJoinCode`, `picksHandoffSolo`, `processPendingClaim`, … +54 more
- **Module-level state/consts declared here:** `_picksHandoff`, `_scannerStream`, `_scannerAnimFrame`, `_scannerActive`, `_scanHandled`, `_pendingClaimToken`, `_lastClaimWasMerge`, `_pendingPostClaimCrewName`, `_pendingPostClaimCrewId`, `_obJoinedCrewId`, `_obJoinedCrewName`, `INVITE_CODE_LOOKALIKES`, `_codeSubmitting`, `CLAIM_PLUR_WHY`, … +6
- **Tables / buckets (`.from`)**: `artists`, `raver_artist_plans`, `point_events`, `ravers`, `festivals`, `crews`
- **RPCs:** `get_claim_preview`, `get_crew_by_invite_token`, `find_raver_by_invite_code`, `claim_and_merge_raver`, `get_own_and_created_ravers`, `get_crewmate_ravers`


### 3. Welcome, PLUR points, vibes

#### WELCOME BACK POPUP  
`L15363–15562` (200 lines, 13 functions)

- **Functions:** `showWelcomePopup`, `closeWelcomePopup`, `snoozeWelcomePopup`, `refreshFestNudgeState`, `openNotificationSettings`, `setupItemDone`, `setupDoneCount`, `setupPillVisible`, `renderSetupPill`, `setupListHTML`, `openSetupSheet`, `setupGo`, `showGuidanceBanner`
- **Module-level state/consts declared here:** `WBP_GREETINGS`, `SETUP_ITEMS`, `_reminderOptinsLoaded`, `_reminderOptinFestIds`, `_pushBlocked`
- **Tables / buckets (`.from`)**: `set_reminder_optins`

#### HOW WE MET — pairwise thought-bubble stories  
`L15563–15578` (16 lines, 1 functions)

- **Functions:** `metFunnyPlaceholder`
- **Module-level state/consts declared here:** `metStoriesCache`, `MET_FUNNY`

#### PLUR POINTS  
`L15579–15821` (243 lines, 13 functions)

- **Functions:** `loadPlurTotals`, `plurBarHTML`, `loadPlurEventTypes`, `openPlurInfo`, `closePlurInfo`, `plurInfoBodyHTML`, `togglePlurLedger`, `loadPlurTiers`, `openPlurMilestones`, `closePlurMilestones`, `plurMilestonesBodyHTML`, `loadMetStories`, `saveMetStory`
- **Module-level state/consts declared here:** `PLUR_TRACK_META`, `_plurEventTypesCache`, `_plurTiersCache`
- **Tables / buckets (`.from`)**: `point_event_types`, `point_events`, `point_tiers`, `met_stories`
- **RPCs:** `get_raver_points`

#### Festival Vibe Bubbles  
`L15822–16131` (310 lines, 17 functions)

- **Functions:** `loadAllFestVibes`, `saveFestVibe`, `clearFestVibe`, `buildVibeRowHTML`, `renderVibeRow`, `vibePickerSlot`, `openVibePicker`, `closeVibePicker`, `selectVibeEmoji`, `doVibeSave`, `doVibeClear`, `howWeMetSectionHTML`, `ravesTogetherVibe`, `ravesTogetherSectionHTML`, `startEditMetStory`, `cancelEditMetStory`, … +1 more
- **Module-level state/consts declared here:** `VIBE_EMOJIS`, `CUSTOM_VIBE_EMOJIS`, `_vibePickerFestId`, `_vibePickerEmoji`, `_customVibeEmoji`
- **Tables / buckets (`.from`)**: `festival_vibes`


### 4. Data write helpers, audit, notifications, photos

#### SUPABASE WRITE HELPERS  
`L16132–16395` (264 lines, 15 functions)

- **Functions:** `savePrivacySettings`, `dbSaveRaver`, `dbSaveRaverFestivals`, `dbSaveRaverFavoriteArtists`, `dbAddRaverFestival`, `dbRemoveRaverFestival`, `dbSetRaverFestivalTicketType`, `dbAddRaverFestivalInterest`, `dbRemoveRaverFestivalInterest`, `dbSaveFestival`, `dbDeleteFestival`, `dbSaveCrew`, `dbSaveCrewMembers`, `dbAddCrewMember`, `dbRemoveCrewMember`
- **Tables / buckets (`.from`)**: `ravers`, `raver_festivals`, `raver_favorite_artists`, `raver_festival_interest`, `festivals`, `crews`, `crew_members`

#### SOFT DELETE & AUDIT HELPERS  
`L16396–16535` (140 lines, 7 functions)

- **Functions:** `softDeleteRow`, `dbRestoreRow`, `dbLoadRecentDestructiveActions`, `auditRowToRestoreTargets`, `restoreFromAuditRowById`, `restoreFromAuditRow`, `logAudit`
- **Tables / buckets (`.from`)**: `audit_logs`

#### HISTORY / ACTIVITY VIEWS  
`L16536–16620` (85 lines, 6 functions)

- **Functions:** `historyActionMeta`, `historyRowHTML`, `buildHistoryListHTML`, `dbLoadFestivalHistory`, `dbLoadCrewHistory`, `dbLoadRaverHistory`
- **Module-level state/consts declared here:** `HISTORY_ACTION_META`
- **RPCs:** `get_festival_history`, `get_crew_history`, `get_raver_history`

#### NOTIFICATION DB HELPERS  
`L16621–16708` (88 lines, 9 functions)

- **Functions:** `nlRave`, `nlCrew`, `nlRaver`, `nlHuddle`, `nlData`, `dbAddNotification`, `dbLoadNotifications`, `dbMarkNotifsRead`, `notifyCrewMembers`
- **Module-level state/consts declared here:** `_notifLoadSeq`
- **Tables / buckets (`.from`)**: `notifications`

#### PHOTO HELPERS  
`L16709–18076` (1368 lines, 87 functions)

- **Functions:** `compressImageToBlob`, `uploadPhotoToStorage`, `handleProfilePhotoUpload`, `doProfilePhotoUpload`, `showPhotoConfirm`, `closePhotoConfirm`, `removeProfilePhoto`, `openRaverColorPicker`, `closeRaverColorPicker`, `selectRaverColorSwatch`, `saveRaverColor`, `handleTotemPhotoUpload`, `editTotemPhoto`, `openTotemCropper`, `startCropper`, `totemCropZoom`, … +71 more
- **Module-level state/consts declared here:** `_colorPickerRaverId`, `_totemCropper`, `_totemCropContext`, `_totemTabByCrewId`, `_totemPhotoActionsRevealed`, `_totemIconGridRevealed`, `ourPhotosCache`, `viewerNotesCache`, `_viewerNoteTimers`, `cropState`, `cropDrag`, `lightboxCtx`, `MEETUP_STATUS_COLOR`, `MEETUP_STATUS_RING_STYLE`, … +7
- **Tables / buckets (`.from`)**: `photos`, `ravers`, `crews`, `our_photos`, `private_phones`, `raver_nicknames`, `viewer_notes`, `huddle_messages`
- **RPCs:** `disconnect_raver`


### 5. Crews: model, cards, list, detail

#### Crew data model  
`L18077–18121` (45 lines, 1 functions)

- **Functions:** `getCrew`
- **Module-level state/consts declared here:** `STATUS`, `crewSeq`, `crews`

#### Lineup Explorer links  
`L18122–18177` (56 lines, 2 functions)

- **Functions:** `getLineupExplorerUrl`, `openLineupExplorer`
- **Module-level state/consts declared here:** `LINEUP_EXPLORERS`

#### Set reminders from the app (fest-week card)  
`L18178–18275` (98 lines, 2 functions)

- **Functions:** `buildSetReminderList`, `turnOnSetRemindersInApp`
- **Module-level state/consts declared here:** `_remindBusy`
- **Tables / buckets (`.from`)**: `raver_clash_choices`
- **RPCs:** `get_lineup_set_times`, `get_lineup_crew_votes`, `set_set_reminders`

#### Festival date parsing & "next up" computation  
`L18276–18491` (216 lines, 14 functions)

- **Functions:** `festDate`, `isFestAchieved`, `parseFestDate`, `festWhenLabel`, `daysUntil`, `countdownLabel`, `countdownStampParts`, `raveQuickDateWindow`, `raveDurationLabel`, `countdownDays`, `crewSquad`, `crewNextUp`, `crewNextFestBlock`, `avatarsHTML`
- **Module-level state/consts declared here:** `TODAY`, `MONTHS`, `MON_SHORT`, `DOW_SHORT`

#### Shareable Crew Card (Rave Pass / Laminate)  
`L18492–18961` (470 lines, 22 functions)

- **Functions:** `openCrewShareCard`, `setCrewShareMode`, `toggleCrewSharePhoto`, `closeCrewShareCard`, `crewSharePerfHTML`, `crewShareBarcodeHTML`, `renderCrewShareQRCode`, `renderCrewShareCard`, `updateCrewShareCaption`, `isIOSSafari`, `withTimeout`, `buildCrewShareText`, `shareCrewTextFallback`, `waitForCardImages`, `inlineCardImagesAsBlobs`, `swap`, … +6 more
- **Module-level state/consts declared here:** `_crewShareMode`, `_crewSharePhotoEnabled`, `_crewShareBlob`, `_crewShareToken`, `_crewShareCaptionTimer`

#### Shareable Rave Card (Gig Poster)  
`L18962–19375` (414 lines, 19 functions)

- **Functions:** `openRaveShareCard`, `closeRaveShareCard`, `raveShareBarcodeHTML`, `raveShareUrl`, `renderRaveShareQRCode`, `renderRaveShareCard`, `updateRaveShareCaption`, `buildRaveShareText`, `shareRaveLinkNow`, `shareRaveTextFallback`, `flattenRaveAvatarImagesForCapture`, `setRaveShareButtonState`, `prepareRaveShareImage`, `shareRaveCardNow`, `shareRaveImageBlob`, `showRaveShareImageResult`, … +3 more
- **Module-level state/consts declared here:** `_raveShareBlob`, `_raveShareToken`, `_raveShareCaptionTimer`, `_raveShareTopSets`
- **Tables / buckets (`.from`)**: `festivals`

#### HOME SCREEN COUNTDOWN  
`L19376–19470` (95 lines, 6 functions)

- **Functions:** `countdownUrl`, `openCountdownSheet`, `openMyCountdownSheet`, `closeCountdownSheet`, `renderCountdownSheet`, `revokeCountdownLink`
- **Module-level state/consts declared here:** `_countdownSheet`
- **RPCs:** `create_countdown_link`, `revoke_countdown_link`

#### CREW PRESENCE (Crews list "here now" glow)  
`L19471–19612` (142 lines, 9 functions)

- **Functions:** `crewActivitySharingOn`, `myCrewPresenceSpot`, `syncCrewPresenceChannels`, `updateCrewPresence`, `teardownCrewPresence`, `crewPresenceLine`, `crewRowBaseSub`, `refreshCrewPresenceRow`, `toggleCrewActivitySharing`
- **Module-level state/consts declared here:** `_crewPresenceChannels`, `_crewPresenceState`, `_crewPresenceTracked`, `_crewPresenceTicker`, `_crewPresenceListening`

#### CREW LIST ROWS (Crews tab accordion)  
`L19613–19932` (320 lines, 16 functions)

- **Functions:** `toggleCrewRow`, `crewRowMeToo`, `crewRowTotemHTML`, `crewRowHTML`, `huddleCountsAsUnread`, `loadHuddleActivityCache`, `recomputeHuddleUnreadTotals`, `huddleHasQuietActivity`, `totalHuddleUnreadCount`, `markHuddleRoomRead`, `huddleActivityBadge`, `huddleCtaHTML`, `loadHuddleDrawerEntries`, `isNotifDrawerOpen`, `refreshHuddleDrawerIfOpen`, `toggleStatus`
- **Module-level state/consts declared here:** `_crewOpenId`, `_huddleActivityCache`, `_huddleRoomUnreadCache`, `_huddleRoomQuietCache`, `_huddleRoomCrewMap`, `_huddleReadMap`, `_huddleUnreadCache`, `_huddleActivityLoading`, `_huddleDrawerEntries`
- **Tables / buckets (`.from`)**: `huddle_room_reads`, `huddle_messages`, `huddle_rooms`

#### Crew detail view  
`L19933–20097` (165 lines, 3 functions)

- **Functions:** `openDetail`, `closeDetail`, `closeDetailOutside`
- **Module-level state/consts declared here:** `activeDetailId`, `dreamPins`, `archiveLinks`, `crewPolls`, `crewPollVotes`, `crewJams`, `crewJamVibes`, `_crewFeatureReadMap`, `_crewFeedFilter`, `_crewFeedSeen`, `crewPlanCheckoffs`, `gamePlans`, `gamePlanItems`, `setMeetups`, … +23


### 6. Moderation and admin dashboards

#### MOD DASHBOARD  
`L20098–20266` (169 lines, 10 functions)

- **Functions:** `openModDashboard`, `closeModDashboard`, `renderModDashboard`, `switchModDashTab`, `renderModDashBody`, `renderModGifPackInto`, `readModGifDimensions`, `uploadModGifPackItem`, `toggleModGifPackActive`, `deleteModGifPackItem`
- **Module-level state/consts declared here:** `modDashTab`, `modDashRecentRows`, `modDashOpenFlags`, `HUDDLE_GIF_PACK_MAX_BYTES`
- **Tables / buckets (`.from`)**: `huddle-gifs`, `huddle_gif_pack`

#### MOD DASHBOARD: Set times tab  
`L20267–20344` (78 lines, 5 functions)

- **Functions:** `dbLoadSetTimeReports`, `fmtSetTimeRange`, `renderSetTimeReportsHTML`, `setTimeReportCardHTML`, `reviewSetTimeReport`
- **Module-level state/consts declared here:** `modSetTimeReports`
- **Tables / buckets (`.from`)**: `set_time_reports`, `artist_festival_appearances`
- **RPCs:** `review_set_time`

#### MOD DASHBOARD: Missing Genres tab  
`L20345–20486` (142 lines, 10 functions)

- **Functions:** `dbLoadMissingGenreArtists`, `allKnownArtistGenres`, `renderMissingGenresHTML`, `missingGenreCardHTML`, `modGenreSearchInput`, `modGenrePick`, `removeDraftGenre`, `rerenderMissingGenresBody`, `handleSaveArtistGenres`, `formatModDate`
- **Module-level state/consts declared here:** `modMissingGenreArtists`, `modGenreDrafts`, `FLAG_TARGET_LABELS`
- **Tables / buckets (`.from`)**: `artists`

#### MOD DASHBOARD: report card  
`L20487–20602` (116 lines, 5 functions)

- **Functions:** `modPersonHTML`, `modOwnerExtraHTML`, `modHistoryHTML`, `flagCardHTML`, `modOpenPerson`
- **Module-level state/consts declared here:** `SANCTION_META`

#### MOD DASHBOARD: action sheets  
`L20603–20793` (191 lines, 13 functions)

- **Functions:** `plurRuleTitle`, `modRuleSelectHTML`, `modDraftFlag`, `openModRemoveSheet`, `openModSanctionSheet`, `onModDraftField`, `modDraftReady`, `modChipRowHTML`, `renderModActionSheet`, `noteField`, `submitModAction`, `handleRevokeSanction`, `recentDeleteCardHTML`
- **Module-level state/consts declared here:** `RESTRICT_FEATURES`, `RESTRICT_DURATIONS`, `SUSPEND_DURATIONS`, `_modDraft`

#### MOD GUIDE (quick reference tab)  
`L20794–20976` (183 lines, 9 functions)

- **Functions:** `toggleModGuideSection`, `modGuideBullet`, `modGuideCallout`, `modGuideSectionHTML`, `renderModGuideHTML`, `viewFlagTarget`, `handleDismissFlag`, `handleResolveFlag`, `goToProfileFromDetail`
- **Module-level state/consts declared here:** `modGuideOpenSections`, `MOD_GUIDE_SECTIONS`

#### PM METRICS DASHBOARD (super-admin only)  
`L20977–21861` (885 lines, 41 functions)

- **Functions:** `loadChartJs`, `pmFmt`, `pmPct`, `pmMonthLabel`, `pmWeekLabel`, `openPMDashboard`, `closePMDashboard`, `renderPMDashboard`, `pmChartOrFallback`, `renderPMDashBody`, `pmKpiCard`, `pmEmptyNote`, `pmEngagementRows`, `pmRetentionTable`, `pmExplorerSection`, `pmBriefingSection`, … +25 more
- **Module-level state/consts declared here:** `pmDashData`, `pmExplorerData`, `pmBriefingData`, `pmSupportData`, `pmAndroidBetaData`, `pmDashCharts`, `_chartJsPromise`, `PM_BRIEFING_SKIP_LABELS`, `PM_ABETA_STATUSES`, `PM_SUPPORT_KIND`, `PM_SUPPORT_STATUSES`
- **Tables / buckets (`.from`)**: `support-screenshots`
- **RPCs:** `get_pm_dashboard_metrics`, `get_explorer_metrics`, `get_mission_briefing_metrics`, `get_support_inbox`, `get_admin_android_beta`, `set_android_beta_status`, `set_support_message_status`


### 7. Crew page: feed, Huddle, GIFs

#### CREW FEED (beta crew page)  
`L21862–22872` (1011 lines, 60 functions)

- **Functions:** `isCrewFeedPage`, `renderCrewFeedPage`, `crewFeedHeaderHTML`, `crewTicketStackHTML`, `crewTicketDotsHTML`, `crewPastTicketHTML`, `crewTicketSightingsNudge`, `openRaveSightings`, `openCrewPastRaves`, `scrollCrewTicketsToNext`, `fitCrewTicketStack`, `onCrewTicketScroll`, `openCrewFeedPlan`, `crewPlanSectionCounts`, `n`, `refreshCrewPlanChrome`, … +44 more
- **Module-level state/consts declared here:** `CREW_FEED_FILTERS`, `CREW_TICKET_PAST_MAX`, `_crewTicketScrollTimer`, `CREW_FEED_KINDS`, `_crewFeedRenderQueued`, `CREW_FEED_SIGHTINGS_DAYS`, `CREW_FEED_REACTIONS`, `_crewFeedPickerId`, `_crewFeedPressTimer`, `_crewFeedLongPressAt`, `_crewPlanChannel`, `_crewPlanRerenderTimer`, `_crewFeedAddMenuCloser`, `CREW_FEATURE_READ_KEYS`
- **Tables / buckets (`.from`)**: `game_plan_items`, `game_plans`, `crew_feature_reads`
- **RPCs:** `toggle_crew_feed_reaction`

#### HUDDLE  
`L22873–25025` (2153 lines, 122 functions)

- **Functions:** `deriveCrewFestivalRooms`, `deriveCrewFestivalPlans`, `lastDay`, `crewJoinedAt`, `huddleSenderName`, `huddleSenderColor`, `huddleRoomLabel`, `festivalIsArchived`, `huddleRoomIsPast`, `huddleTimeOf`, `huddleClockTime`, `huddleDayKey`, `huddleDayLabel`, `huddleDurationLabel`, `openHuddle`, `huddleGuidanceOnOpen`, … +106 more
- **Module-level state/consts declared here:** `HUDDLE_REACTION_EMOJIS`, `HUDDLE_PAGE_SIZE`, `HUDDLE_GROUP_GAP_MS`, `HUDDLE_SENDER_COLORS`, `huddleRooms`, `_huddlePastRoomsOpen`, `huddleMessages`, `_huddleActiveCrewId`, `_huddleActiveRoomId`, `_huddleActiveBeacon`, `_pendingMeetupPin`, `_huddleChannel`, `_huddlePresenceChannel`, `_huddlePresenceState`, … +37
- **Tables / buckets (`.from`)**: `huddle_rooms`, `huddle_messages`, `huddle_room_reads`
- **Edge functions:** `link-preview`

#### HUDDLE GIFS  
`L25026–25875` (850 lines, 62 functions)

- **Functions:** `resetHuddleGifState`, `huddleGifReducedMotion`, `huddleGifMediaHTML`, `huddleGifFromPack`, `huddleGifFromFav`, `huddleGifValid`, `loadHuddleGifPack`, `loadHuddleGifFavorites`, `fetchHuddleGifs`, `openHuddleGifPicker`, `closeHuddleGifPicker`, `switchHuddleGifTab`, `onHuddleGifSearchInput`, `pickHuddleGifTag`, `runHuddleGifSearch`, `huddleGifMaybeLoadMore`, … +46 more
- **Module-level state/consts declared here:** `HUDDLE_GIF_QUICK_TAGS`, `_hdGifTab`, `_hdGifQuery`, `_hdGifNext`, `_hdGifLoading`, `_hdGifError`, `_hdGifSeq`, `_hdGifDebounce`, `_hdGifInlineQuery`, `_hdGifPackRows`, `_hdGifFavRows`, `_hdGifLists`, `_huddleRowPressTimer`, `_huddleLongPressAt`, … +2
- **Tables / buckets (`.from`)**: `huddle_gif_pack`, `huddle_gif_favorites`, `huddle_messages`, `huddle-media`
- **Edge functions:** `giphy-proxy`


### 8. Rave Plan (Game Plan), Mission Briefing, Dream Board, Archive, Polls, Jams

#### GAME PLAN  
`L25876–27558` (1683 lines, 105 functions)

- **Functions:** `gamePlanRoleIcon`, `dbGetOrCreateGamePlan`, `dbUpdateGamePlanHeader`, `dbLoadGamePlanItems`, `dbDeleteGamePlanItem`, `postHuddleSystemMessage`, `postGamePlanActivity`, `postCrewActivity`, `activityAbout`, `activityWho`, `dbAddGamePlanTask`, `dbToggleGamePlanTaskDone`, `dbClaimGamePlanTask`, `dbSetGamePlanTaskPhase`, `dbAddGamePlanRole`, `dbAddCarpoolDriver`, … +89 more
- **Module-level state/consts declared here:** `GAME_PLAN_ROLES`, `GAME_PLAN_ROLE_ICONS`, `LODGING_TYPES`, `BUDGET_CURRENCIES`, `GAME_PLAN_TASK_PHASES`, `GAME_PLAN_TASK_STARTER_PACK`, `GAME_PLAN_TEMPLATES`, `_crewPlanTemplates`, `_gamePlanPendingRole`, `OUTFIT_REACTION_EMOJIS`, `_gamePlanPendingOutfitImageFile`, `_gamePlanLineupEditing`
- **Tables / buckets (`.from`)**: `game_plans`, `game_plan_items`, `huddle_rooms`, `huddle_messages`, `crew_plan_templates`, `set_meetups`

#### MISSION BRIEFING  
`L27559–28578` (1020 lines, 71 functions)

- **Functions:** `mbPlan`, `mbFest`, `mbGoing`, `mbPerson`, `mbFirst`, `mbInitials`, `mbItems`, `mbMe`, `mbCanManage`, `mbAv`, `mbPeopleOptions`, `mbMyReady`, `mbReadyCount`, `mbNeedsRide`, `mbChangedCards`, `after`, … +55 more
- **Module-level state/consts declared here:** `MB_CARDS`, `MB_CARD_KINDS`, `MB_KIT_STARTER`, `MB_VACANT_ROLES`, `_mb`, `MB_BUILDERS`, `MB_STATS_TTL_MS`, `_mbStatsCache`
- **Tables / buckets (`.from`)**: `artist_festival_appearances`, `huddle_messages`, `game_plans`, `game_plan_items`

#### Dream Board  
`L28579–28729` (151 lines, 9 functions)

- **Functions:** `dbLoadDreamPins`, `dbAddDreamPin`, `dbDeleteDreamPin`, `dbToggleHype`, `addDreamPin`, `deleteDreamPin`, `toggleHype`, `rerenderDreamBoard`, `buildDreamBoardHTML`
- **Tables / buckets (`.from`)**: `dream_board_pins`

#### The Archive — crew photo drop links  
`L28730–28905` (176 lines, 8 functions)

- **Functions:** `dbLoadArchiveLinks`, `dbAddArchiveLink`, `dbDeleteArchiveLink`, `addArchiveLink`, `deleteArchiveLink`, `rerenderArchive`, `toggleArchiveFilter`, `buildArchiveHTML`
- **Tables / buckets (`.from`)**: `crew_archive_links`

#### Crew History  
`L28906–28939` (34 lines, 3 functions)

- **Functions:** `rerenderCrewHistory`, `toggleCrewHistoryExpanded`, `buildCrewHistoryHTML`

#### FAM Poll  
`L28940–29727` (788 lines, 40 functions)

- **Functions:** `pollTimeLeft`, `pollIsExpired`, `pollIsOpen`, `pickManyIds`, `pickManyCanVote`, `pickManyTally`, `togglePickManyChoice`, `submitPickManyVote`, `startPickManyChange`, `cancelPickManyChange`, `dbChangePickManyVote`, `crewVoteLineupsHTML`, `toggleCrewVoteLineups`, `dbLoadPolls`, `dbCreatePoll`, `dbVotePoll`, … +24 more
- **Module-level state/consts declared here:** `POLL_OF_THE_DAY`, `POLL_VIBE_EMOJIS`, `pickManyDraft`, `pickManyChanging`, `_createPollCrewId`, `_createPollType`, `_createPollAnonymous`, `_createPollOptionCount`
- **Tables / buckets (`.from`)**: `crew_poll_votes`, `crew_polls`

#### FAM Jams  
`L29728–30330` (603 lines, 34 functions)

- **Functions:** `detectPlatform`, `fetchPlaylistMeta`, `dbLoadJams`, `dbAddJam`, `dbDeleteJam`, `dbTogglePinJam`, `dbToggleReaction`, `renderReactionsHTML`, `dbToggleJamReaction`, `dbSaveJamVibe`, `dbDeleteJamVibe`, `dbNominateJamAsPoll`, `rerenderJams`, `toggleJamFilter`, `toggleRaveFilter`, `setRaveTimeTab`, … +18 more
- **Module-level state/consts declared here:** `JAM_TAGS`, `JAM_REACTION_EMOJIS`, `PLATFORM_STYLES`, `_addJamCrewId`, `_addJamMeta`
- **Tables / buckets (`.from`)**: `crew_jams`, `crew_jam_vibes`
- **Edge functions:** `fetch-playlist-meta`


### 9. Vendor Village and Venue Directory

#### VENDOR VILLAGE — data layer  
`L30331–30404` (74 lines, 5 functions)

- **Functions:** `dbLoadVendors`, `dbAddVendor`, `dbUpdateVendor`, `dbTagVendorFestivals`, `dbLoadVendorFestivalTags`
- **Tables / buckets (`.from`)**: `vendors`, `vendor_festival_tags`

#### VENDOR VILLAGE — Vendor vibe tags (Feature 2)  
`L30405–30480` (76 lines, 7 functions)

- **Functions:** `dbLoadVendorVibeTags`, `dbAddVendorVibeTag`, `dbRemoveVendorVibeTag`, `vendorVibeTagChipsHTML`, `toggleVendorVibeTagPicker`, `handleAddVendorVibeTag`, `handleRemoveVendorVibeTag`
- **Tables / buckets (`.from`)**: `vendor_vibe_tags`

#### VENDOR VILLAGE — Spotted-right-now live check-ins (Feature 3)  
`L30481–30546` (66 lines, 6 functions)

- **Functions:** `dbLoadVendorSpots`, `dbLoadMyVendorSpots`, `dbAddVendorSpot`, `dbDeleteVendorSpot`, `vendorLiveSpots`, `vendorLiveSpotBadgeHTML`
- **Tables / buckets (`.from`)**: `vendor_spots`

#### VENDOR VILLAGE — Personal badges (Feature 6)  
`L30547–30745` (199 lines, 15 functions)

- **Functions:** `dbLoadMyVendorBadges`, `getVendorBadgeProgress`, `awardVendorBadge`, `checkAndAwardVendorBadges`, `vendorBadgeProfileMentionHTML`, `dbDeleteVendor`, `dbSetVendorSponsored`, `dbToggleSaveVendor`, `dbLoadSavedVendors`, `dbLoadVendorReviews`, `dbUpsertVendorReview`, `dbDeleteVendorReview`, `vendorRatingSummary`, `vendorAttributeTagTally`, `vendorAttributeTallyLineHTML`
- **Module-level state/consts declared here:** `VENDOR_BADGE_DEFINITIONS`, `vendorRaverBadges`
- **Tables / buckets (`.from`)**: `vendor_raver_badges`, `vendors`, `saved_vendors`, `vendor_reviews`

#### VENDOR VILLAGE — UI  
`L30746–30895` (150 lines, 7 functions)

- **Functions:** `renderVendorVillage`, `renderVillageRespectCard`, `vendorVillageShellHTML`, `loadVendorVillageData`, `renderVendorVillagePanel`, `switchVendorTab`, `jumpToVendorVillage`
- **Module-level state/consts declared here:** `vendorVillageTab`, `VENDOR_CATEGORY_LABELS`, `VENDOR_VIBE_PRESETS`, `VENDOR_ATTRIBUTE_TAG_PRESETS`

#### VENDOR VILLAGE — Browse panel  
`L30896–30981` (86 lines, 9 functions)

- **Functions:** `renderVendorBrowsePanel`, `vendorBrowsePanelHTML`, `vendorMatchesSearch`, `vendorBrowseListHTML`, `renderVendorBrowseList`, `onVendorSearchInput`, `clearVendorFestFilter`, `toggleVendorCategoryFilter`, `vendorPlaceholderEmoji`
- **Module-level state/consts declared here:** `_vendorCategoryFilter`, `_vendorSearchQuery`, `_vendorFestFilter`

#### VENDOR VILLAGE — Crew cosigns (Feature 1, no schema — pure client-side)  
`L30982–31063` (82 lines, 4 functions)

- **Functions:** `vendorCrewCosigns`, `vendorCosignLineHTML`, `vendorCardHTML`, `handleToggleSaveVendor`

#### VENDOR VILLAGE — Saved panel  
`L31064–31076` (13 lines, 1 functions)

- **Functions:** `renderVendorSavedPanel`

#### VENDOR VILLAGE — Add Vendor form  
`L31077–31195` (119 lines, 6 functions)

- **Functions:** `renderVendorSubmitPanel`, `vendorSubmitPanelHTML`, `selectVendorSubmitCategory`, `toggleVendorSubmitFestival`, `handleVendorPhotoPicked`, `handleVendorSubmit`
- **Module-level state/consts declared here:** `_vendorSubmitCategory`, `_vendorSubmitFestivalIds`
- **Tables / buckets (`.from`)**: `vendors`

#### VENDOR VILLAGE — Edit Vendor modal (Feature 4)  
`L31196–31318` (123 lines, 7 functions)

- **Functions:** `openEditVendorModal`, `closeEditVendorModal`, `vendorEditModalHTML`, `selectVendorEditCategory`, `handleVendorEditPhotoPicked`, `handleVendorEditSubmit`, `copyDiscountCode`
- **Module-level state/consts declared here:** `_vendorEditCategory`
- **Tables / buckets (`.from`)**: `vendors`

#### VENDOR VILLAGE — Detail view + reviews  
`L31319–31592` (274 lines, 15 functions)

- **Functions:** `openVendorDetail`, `closeVendorDetail`, `vendorDetailModalHTML`, `vendorReviewComposerHTML`, `toggleVendorReviewAttributeTag`, `handleVendorReviewPhotoPicked`, `highlightVendorStars`, `resetVendorStarHighlight`, `setVendorReviewRating`, `submitVendorReview`, `showFirstReviewMoment`, `vendorReviewRowHTML`, `handleDeleteVendorReview`, `refreshVendorDetailSaveBtn`, `toggleVendorSponsorship`
- **Module-level state/consts declared here:** `_vendorDetailId`, `_vendorDetailDraftRating`, `_vendorDetailDraftAttributeTags`
- **Tables / buckets (`.from`)**: `point_events`

#### VENDOR VILLAGE — Spotted-right-now UI (Feature 3)  
`L31593–31685` (93 lines, 7 functions)

- **Functions:** `vendorSpotsSectionHTML`, `vendorSpotComposerHTML`, `selectVendorSpotFestival`, `submitVendorSpot`, `vendorSpotRowHTML`, `handleDeleteVendorSpot`, `confirmRemoveVendor`
- **Module-level state/consts declared here:** `_vendorSpotFestivalId`

#### VENUE DIRECTORY — data layer  
`L31686–31829` (144 lines, 12 functions)

- **Functions:** `dbLoadVenues`, `findVenueById`, `dbAddVenue`, `dbUpdateVenue`, `dbDeleteVenue`, `dbLoadVenueReviews`, `dbUpsertVenueReview`, `dbDeleteVenueReview`, `venueRatingSummary`, `venueRavesHeldHere`, `venueCrewCosigns`, `venueCosignLineHTML`
- **Module-level state/consts declared here:** `venues`, `venueReviewsCache`
- **Tables / buckets (`.from`)**: `venues`, `venue_reviews`

#### VENUE DIRECTORY — UI  
`L31830–31919` (90 lines, 9 functions)

- **Functions:** `renderVillage`, `switchVillageSection`, `maybeVenuesIntro`, `renderVenueVillage`, `venueVillageShellHTML`, `loadVenueVillageData`, `renderVenueVillagePanel`, `switchVenueTab`, `jumpToVenueVillage`
- **Module-level state/consts declared here:** `villageSection`, `venueVillageTab`

#### VENUE DIRECTORY — Browse panel  
`L31920–31999` (80 lines, 7 functions)

- **Functions:** `renderVenueBrowsePanel`, `venueBrowsePanelHTML`, `venueMatchesSearch`, `venueBrowseListHTML`, `renderVenueBrowseList`, `onVenueSearchInput`, `venueCardHTML`
- **Module-level state/consts declared here:** `_venueSearchQuery`

#### VENUE DIRECTORY — Add Venue form  
`L32000–32087` (88 lines, 4 functions)

- **Functions:** `renderVenueSubmitPanel`, `venueSubmitPanelHTML`, `handleVenuePhotoPicked`, `handleVenueSubmit`
- **Tables / buckets (`.from`)**: `venues`

#### VENUE DIRECTORY — Edit Venue modal  
`L32088–32192` (105 lines, 5 functions)

- **Functions:** `openEditVenueModal`, `closeEditVenueModal`, `venueEditModalHTML`, `handleVenueEditPhotoPicked`, `handleVenueEditSubmit`
- **Tables / buckets (`.from`)**: `venues`

#### VENUE DIRECTORY — Detail view + reviews  
`L32193–32366` (174 lines, 11 functions)

- **Functions:** `openVenueDetail`, `closeVenueDetail`, `venueDetailModalHTML`, `venueReviewComposerHTML`, `highlightVenueStars`, `resetVenueStarHighlight`, `setVenueReviewRating`, `submitVenueReview`, `venueReviewRowHTML`, `handleDeleteVenueReview`, `confirmRemoveVenue`
- **Module-level state/consts declared here:** `_venueDetailId`, `_venueDetailDraftRating`


### 10. FAM Pins, crew membership, invites

#### FAM PINS — Crew Achievements  
`L32367–33321` (955 lines, 36 functions)

- **Functions:** `dbLoadAchievements`, `getBadgeProgress`, `awardAchievement`, `checkAndAwardBadges`, `crewFeatureIconSVG`, `zoneBadgeHTML`, `refreshZoneBadges`, `setZoneState`, `maybeOpenZoneIntro`, `crewQuestDefs`, `crewQuestRowHTML`, `rerenderCrewQuestRow`, `markCrewQuest`, `retireCrewQuests`, `maybeShowCrewWelcome`, `buildCrewFeatureTilesHTML`, … +20 more
- **Module-level state/consts declared here:** `CREW_FEATURE_GLYPHS`, `ZONE_COLORS`, `ZONE_INTROS`, `_statusWarnId`, `_statusWarnTarget`, `CREW_LIMIT`, `CREW_LIMIT_WARN`, `CREW_VIBE_PLACEHOLDERS`
- **Tables / buckets (`.from`)**: `crew_achievements`, `raver_achievements`, `crew_feed_events`, `raver_festival_interest`, `raver_festivals`, `crew_members`
- **RPCs:** `request_leave_crew`, `purge_raver_data`

#### Crew Pick Dialog (shown after adding a new raver)  
`L33322–33443` (122 lines, 6 functions)

- **Functions:** `openCrewPickDialog`, `renderCrewPickDialog`, `toggleCrewPick`, `saveCrewPick`, `closeCrewPickAndProfile`, `closeCrewPick`
- **Module-level state/consts declared here:** `_crewPickRaverId`, `_crewPickRaverRef`, `_crewPickSelected`

#### Invite Prompt (shown after the Crew Pick step for a new raver)  
`L33444–33547` (104 lines, 8 functions)

- **Functions:** `raverInviteIsLive`, `inviteHeldBackReason`, `maybeOfferInvite`, `openInvitePrompt`, `closeInvitePrompt`, `shareInviteLink`, `shareInviteFromPrompt`, `showInviteQR`
- **Module-level state/consts declared here:** `_invitePromptRaverId`

#### Crew Edit (rename + recolour)  
`L33548–33642` (95 lines, 5 functions)

- **Functions:** `colourName`, `showCrewEditModal`, `closeCrewEditModal`, `selectCrewEditSwatch`, `saveCrewEdit`
- **Module-level state/consts declared here:** `_editingCrewId`, `EDIT_SWATCH_COLORS`, `COLOR_NAMES`

#### Crew invite link  
`L33643–33905` (263 lines, 10 functions)

- **Functions:** `crewInviteUrl`, `generateAndShareCrewInvite`, `crewInviteSent`, `shareCrewInvite`, `copyCrewInvite`, `showCrewJoinModal`, `closeCrewJoinModal`, `confirmJoinCrew`, `crewTotemMarkHTML`, `rgbToHex`
- **Module-level state/consts declared here:** `_pendingCrewJoinToken`, `CREW_GRADIENTS`, `TOTEM_ICONS`, `TOTEM_ICON_MAP`
- **Tables / buckets (`.from`)**: `crews`
- **RPCs:** `join_crew_via_invite`


### 11. Tags, genres, festivals catalog, profiles, artists/lineups

#### Vibe Tags — preset catalog  
`L33906–33968` (63 lines, 0 functions)

- **Module-level state/consts declared here:** `VIBE_CATEGORIES`, `VIBE_PRESETS`

#### Genre Presets  
`L33969–34051` (83 lines, 6 functions)

- **Functions:** `genreColor`, `genreCategory`, `artistColor`, `getPreset`, `vibeTagHTML`, `dataFor`
- **Module-level state/consts declared here:** `GENRE_PRESETS`, `GENRE_FAMILY_COLORS`, `GENRE_CATEGORIES`, `GENRE_CATEGORY_MAP`, `_ARTIST_PAL`

#### Festivals catalog — single source of truth  
`L34053–34389` (337 lines, 21 functions)

- **Functions:** `getFestival`, `findFestivalByName`, `getRaver`, `escHtml`, `escJsAttr`, `safeColor`, `safeGradient`, `extractFirstColor`, `raverAvatarHTML`, `initials`, `raverFestivals`, `raverUpcoming`, `raverPast`, `ravesTogetherData`, `cityOf`, `ourPhotoCardHTML`, … +5 more
- **Module-level state/consts declared here:** `festSeq`, `festivals`, `DEMO_ARTISTS`, `squadSeq`, `squad`, `_seeAsCrew`

#### Dedicated profile page  
`L34390–34409` (20 lines, 2 functions)

- **Functions:** `rerenderRaverHistory`, `toggleRaverHistorySection`
- **Module-level state/consts declared here:** `raverHistoryRows`, `raverHistoryExpanded`, `_raverHistoryLoadedFor`

#### Profile shelves — "See all" sheet + Sound expander  
`L34410–34513` (104 lines, 6 functions)

- **Functions:** `profileListSheetContent`, `festRow`, `renderProfileListSheet`, `setManageRavesTab`, `openProfileListSheet`, `closeProfileListSheet`
- **Module-level state/consts declared here:** `_profileListSheet`

#### Profile tabs — Raves · Vibe · Crews · Us/Notes  
`L34514–34642` (129 lines, 13 functions)

- **Functions:** `profileDefaultTab`, `setProfileEditTab`, `setProfileTab`, `showProfileTabPane`, `setProfileRaveSeg`, `scrollProfilePaneIntoView`, `initProfileTabSwipe`, `toggleProfileMoreMenu`, `_onProfileMoreOutside`, `closeProfileMoreMenu`, `profileRemoveRave`, `profileMeToo`, `toggleShelfSound`
- **Module-level state/consts declared here:** `_profileTabs`, `_profileRaveSeg`, `_profileEditTab`, `_profileSwipeReady`

#### Profile page render (openProfile)  
`L34643–35345` (703 lines, 21 functions)

- **Functions:** `profileCtx`, `profileTagChipHTML`, `profileConnectHTML`, `profileAvatarHTML`, `profilePhotoCountdownHTML`, `renderProfileEdit`, `epane`, `profileRavesPaneHTML`, `shortLoc`, `seeAllTile`, `raveRow`, `segBtn`, `profileVibePaneHTML`, `profileCrewsPaneHTML`, `shelfHead`, `profileUsPaneHTML`, … +5 more
- **Module-level state/consts declared here:** `PROFILE_STAGE_PAL`

#### Community genre pool  
`L35346–35359` (14 lines, 2 functions)

- **Functions:** `allGenrePresets`, `dbLoadCommunityGenres`
- **Module-level state/consts declared here:** `communityGenres`
- **Tables / buckets (`.from`)**: `community_genres`

#### Canonical artists (sourced from lineup-explorer data)  
`L35360–35461` (102 lines, 11 functions)

- **Functions:** `sbSelectAll`, `dbLoadArtists`, `dbLoadArtistAppearances`, `dbLoadArtistSightings`, `dbLoadPostfestCheckoffs`, `dbLoadTopSets`, `dbLoadArtistPlans`, `findArtistById`, `findArtistByName`, `artistSearchResults`, `addNewArtist`
- **Module-level state/consts declared here:** `artists`, `artistAppearances`, `raverArtistSightings`, `raverPostfestCheckoffs`, `raverTopSets`, `raverArtistPlans`
- **Tables / buckets (`.from`)**: `artists`, `artist_festival_appearances`, `raver_artist_sightings`, `raver_postfest_checkoffs`, `raver_top_sets`, `raver_artist_plans`

#### Rave lineup tagging (shared lineup + personal "I saw this" checklist)  
`L35462–35633` (172 lines, 9 functions)

- **Functions:** `lineupArtistsFor`, `myLineupSightingIds`, `myLineupPlanIds`, `canEditFestLineup`, `dbAddLineupArtist`, `dbRemoveLineupArtist`, `dbToggleArtistSighting`, `dbToggleArtistPlan`, `renderFestivalLineupSection`
- **Module-level state/consts declared here:** `PICK_ICON_OFF`, `PICK_ICON_ON`
- **Tables / buckets (`.from`)**: `artist_festival_appearances`, `raver_artist_sightings`, `raver_artist_plans`

#### Post-fest check-off ("Who'd you catch? 📼")  
`L35634–35699` (66 lines, 5 functions)

- **Functions:** `postfestPending`, `postfestState`, `postfestCardHTML`, `postfestMark`, `postfestFinish`
- **Module-level state/consts declared here:** `postfestAnswered`
- **Tables / buckets (`.from`)**: `raver_postfest_checkoffs`

#### Top 3 sets ("What were your top 3 sets? 🏆")  
`L35700–35955` (256 lines, 18 functions)

- **Functions:** `topSetIdsFor`, `myTopSetIds`, `canPickTopSets`, `topSetsPending`, `topSetsCardHTML`, `nameOf`, `topSetsEdit`, `applyTopSetsLocal`, `topSetsTap`, `saveTopSets`, `crewTopSetsHTML`, `showMorningAfter`, `badge`, `nextTierLineHTML`, `lineupArtistSearchInput`, `lineupPickFromSearch`, … +2 more
- **Module-level state/consts declared here:** `TOP_SETS_MAX`, `topSetsEditing`, `_topSetsSave`, `RAVE_MILESTONES`, `MORNING_AFTER_WHY`
- **Tables / buckets (`.from`)**: `point_events`
- **RPCs:** `set_top_sets`

#### Rave editor: venue picker (single-select, search + inline add-new)  
`L35956–36109` (154 lines, 9 functions)

- **Functions:** `renderFestVenuePicker`, `festVenueSearchInput`, `pickFestVenue`, `clearFestVenue`, `captureCurrentLocation`, `renderFestLocationField`, `addNewVenueFromSearch`, `upcomingAppearance`, `favArtistChipHTML`

#### Profile editor (add / edit)  
`L36110–36281` (172 lines, 3 functions)

- **Functions:** `fieldRow`, `openProfileEditor`, `renderFestPicker`
- **Module-level state/consts declared here:** `profileOrigin`, `editingId`, `editingVibeTags`, `editingCustomVibeTags`, `editingFestIds`, `editingFavArtistIds`, `editingGenres`, `editingCustomGenres`

#### Favourite artist picker (search-as-you-type combobox)  
`L36282–36591` (310 lines, 23 functions)

- **Functions:** `renderArtistPicker`, `renderArtistSelected`, `artistRemoveSel`, `removeLastFavArtist`, `artistSearchInput`, `artistPickFromSearch`, `addNewArtistFromSearch`, `renderFestSelected`, `festToggleQuick`, `festRemoveSel`, `festSearchInput`, `festPickFromSearch`, `openNewRavePopup`, `closeNewRavePopup`, `nrpNameSuggest`, `nrpPickExisting`, … +7 more
- **Module-level state/consts declared here:** `_newRaveCtx`

#### Inline profile edit mode  
`L36592–36621` (30 lines, 2 functions)

- **Functions:** `enterProfileEditMode`, `cancelProfileEdit`

#### Tag Sheet — shared bottom-sheet + category-accordion picker for Vibe Tags & Genres  
`L36622–37081` (460 lines, 22 functions)

- **Functions:** `_tagOpenStateFor`, `_tagHighlight`, `renderTagSummary`, `openTagSheet`, `closeTagSheetEl`, `cancelTagSheet`, `commitTagSheet`, `renderTagSheetBody`, `renderTagPinned`, `renderTagAccordion`, `toggleTagAccordionSection`, `onTagSheetSearch`, `tagToggle`, `tagAddCustom`, `tagRemoveCustom`, `renderTagCustomChips`, … +6 more
- **Module-level state/consts declared here:** `TAG_KIND_CONFIG`, `_tagSheetKind`, `_tagSheetSearch`, `_tagPreSearchOpenState`, `_tagSnapshot`, `_tagOpenState`, `_tagEscAttr`, `gradientPool`
- **Tables / buckets (`.from`)**: `community_genres`


### 12. Raves tab, rave editor, Rave Focus, Going options

#### Raves tab — browse & manage the catalog  
`L37082–37228` (147 lines, 6 functions)

- **Functions:** `festColor`, `raveSwatchGradient`, `ticketTypeInfo`, `festivalGoers`, `festivalInterestedGoers`, `raveCrewSectionHTML`
- **Module-level state/consts declared here:** `FALLBACK_COLORS`, `CARD_PALETTE`, `COBWEB_SVG`, `COBWEB_SVG_MINI`, `TICKET_TYPES`, `TICKET_PERSONALITY`

#### Rave weather (Open-Meteo — free, keyless)  
`L37229–37309` (81 lines, 9 functions)

- **Functions:** `loadWeatherCache`, `saveWeatherCache`, `weatherCacheKey`, `weatherEligible`, `weatherIconFor`, `weatherChipHTML`, `fetchFestWeather`, `patchWeatherChip`, `fetchMissingWeather`
- **Module-level state/consts declared here:** `WEATHER_FORECAST_HORIZON_DAYS`, `WEATHER_TTL_MS`, `WEATHER_CACHE_KEY`

#### Nearby raves (distance filter)  
`L37310–37729` (420 lines, 31 functions)

- **Functions:** `loadUserGeo`, `saveUserGeo`, `requestUserLocation`, `onPos`, `onUserLocationSet`, `promptLocationForStats`, `openNearbyLocModal`, `closeNearbyLocModal`, `userLocSearchDebounce`, `userLocSearch`, `pickUserLoc`, `closeUserLocDropdown`, `userLocKeydown`, `haversineMiles`, `festivalLocationSource`, `festGeocodeCacheKey`, … +15 more
- **Module-level state/consts declared here:** `USER_GEO_KEY`, `_locPromptSource`, `_userLocTimer`, `_userLocIdx`, `_userLocItems`, `activeFestId`, `_fysGenres`, `_festPlanOpen`
- **Tables / buckets (`.from`)**: `ravers`, `point_events`, `game_plans`, `game_plan_items`

#### Raves: card view vs. compact list view  
`L37730–38044` (315 lines, 12 functions)

- **Functions:** `getRaveView`, `setRaveView`, `toggleRaveView`, `renderRaveViewToggle`, `toggleRaveRowExpand`, `renderEvents`, `applyRaveSort`, `upDateCompare`, `pastDateCompare`, `actionBarHTML`, `card`, `raveRow`
- **Module-level state/consts declared here:** `RAVE_VIEW_KEY`, `_raveRowExpanded`

#### Location autocomplete (Nominatim / OpenStreetMap)  
`L38045–38134` (90 lines, 6 functions)

- **Functions:** `locSearchDebounce`, `locSearch`, `pickLoc`, `clearLocCoords`, `closeLoc`, `locKeydown`
- **Module-level state/consts declared here:** `_locTimer`, `_locIdx`, `_locItems`

#### Venue location autocomplete (Nominatim / OpenStreetMap)  
`L38135–38243` (109 lines, 10 functions)

- **Functions:** `venueLocSearchDebounce`, `venueLocSearch`, `pickVenueLoc`, `clearVenueLocCoords`, `closeVenueLocDropdown`, `venueLocKeydown`, `venueSubmitLocInput`, `venueSubmitLocKeydown`, `venueEditLocInput`, `venueEditLocKeydown`
- **Module-level state/consts declared here:** `_venueLocTimer`, `_venueLocIdx`, `_venueLocItems`, `VENUE_SUBMIT_LOC_IDS`, `VENUE_EDIT_LOC_IDS`, `_venueLocActiveIds`

#### Rave editor (create / edit / delete a catalog item)  
`L38244–38309` (66 lines, 3 functions)

- **Functions:** `pickRaveColor`, `handleFestivalMapUpload`, `removeFestivalMap`
- **Module-level state/consts declared here:** `editingFestivalId`, `pendingDeleteFestId`, `editRaveColor`, `editingVenueId`, `editRaveLastLocation`
- **Tables / buckets (`.from`)**: `festival-maps`, `festivals`

#### Rave Focus popup — RSVPs + lineup for an existing rave. Tapping a  
`L38310–38997` (688 lines, 29 functions)

- **Functions:** `openRaveFocus`, `closeRaveFocus`, `raveFocusSwitchTab`, `saveMyTicketType`, `rfIcon`, `raveFocusModalHTML`, `ticketOf`, `miniAvatar`, `crewRow`, `fmtFull`, `infoRow`, `panel`, `raveReadyOpenIds`, `raveReadyToggle`, `raveReadyChecklistHTML`, `refreshRaveReadyChecklist`, … +13 more
- **Module-level state/consts declared here:** `_raveFocusTab`, `_raveFocusTabFestId`, `RF_ICONS`, `_raveEditStep`, `_raveEditStepFestId`, `RAVE_EDIT_STEPS`
- **Tables / buckets (`.from`)**: `festival_rsvp_blocks`, `crew_membership_blocks`
- **RPCs:** `resolve_crew_leave_request`

#### Going Options bottom sheet  
`L38998–39657` (660 lines, 36 functions)

- **Functions:** `openGoingOptionsSheet`, `closeGoingOptionsSheet`, `goingOptionsShowOtherInput`, `goingOptionsPickTicketType`, `goingOptionsConfirmOther`, `goingOptionsJustGoing`, `goingOptionsInterested`, `goingOptionsNotGoing`, `releaseOverlayFocus`, `unpan`, `closeRaveEditor`, `reSearch`, `reAdd`, `reAddNew`, `saveRave`, `promptGoingToNewRave`, … +20 more
- **Module-level state/consts declared here:** `_goingOptionsFestId`, `_reSearchQuery`, `checked`, `_suggestVibeRaverId`
- **Tables / buckets (`.from`)**: `festivals`


### 13. Reports, sanctions, settings, delete account, help

#### MODERATION: Report flow  
`L39658–39771` (114 lines, 13 functions)

- **Functions:** `reportCategoryMeta`, `showReportModal`, `renderReportSheet`, `reportDraftReady`, `pickReportCategory`, `onReportDetailsInput`, `submitReportSheet`, `openModSheet`, `closeModSheet`, `closeModSheetOutside`, `plurRuleHTML`, `openPlurCode`, `closePlurCode`
- **Module-level state/consts declared here:** `REPORT_CATEGORIES`, `_reportDraft`

#### MODERATION: my warnings & restrictions  
`L39772–40073` (302 lines, 22 functions)

- **Functions:** `dbLoadMySanctions`, `pendingWarning`, `activeRestriction`, `blockedByRestriction`, `showNextWarningNotice`, `acknowledgeWarning`, `showInfoModal`, `openPrivacySettingsModal`, `rowHTML`, `showSettingsPage`, `updateSettingsSummaries`, `set`, `onCount`, `renderSettingsProfileCard`, `settingsEditProfile`, `settingsVersionTap`, … +6 more
- **Module-level state/consts declared here:** `mySanctions`, `RESTRICTION_COPY`, `_settingsVersionTaps`, `LINEUP_ALERT_TYPES`, `ALERT_TOGGLE_TYPES`
- **Tables / buckets (`.from`)**: `email_preferences`, `lineup_share_links`, `alert_preferences`
- **RPCs:** `my_sanctions`, `ack_sanction`, `turn_off_share_link`

#### DELETE ACCOUNT  
`L40074–40365` (292 lines, 23 functions)

- **Functions:** `openDeleteAccountModal`, `closeDeleteAccountModal`, `doDeleteAccount`, `toggleBeaconPush`, `toggleMentionPush`, `urlBase64ToUint8Array`, `enableBeaconPush`, `ensurePushSubscription`, `disableBeaconPush`, `openAppGuide`, `guideContextKey`, `renderGuideHub`, `worldRow`, `realmState`, `zoneState`, `guideReplay`, … +7 more
- **Module-level state/consts declared here:** `GUIDE_CONTEXT`, `HELP_LEVELS`, `ZONE_LABELS`
- **Tables / buckets (`.from`)**: `photos`, `email_preferences`, `push_subscriptions`
- **RPCs:** `delete_my_account`

#### HELP CENTER  
`L40366–40614` (249 lines, 9 functions)

- **Functions:** `switchGuideTab`, `searchHelpArticles`, `renderHelpFAQ`, `toggleHelpFAQItem`, `update`, `showToast`, `isContentBlocked`, `toastError`, `_showNextToast`
- **Module-level state/consts declared here:** `HELP_CATEGORY_LABELS`, `HELP_ARTICLES`, `toastTimer`, `_toastQueue`, `_toastShowing`


### 14. Overlay plumbing, Guidance Kit, Realms, onboarding

#### ESCAPE CLOSES THE TOP OVERLAY  
`L40615–40709` (95 lines, 4 functions)

- **Functions:** `isOverlayOpen`, `closeTopOverlayOnEscape`, `inertShells`, `syncOverlayInert`
- **Module-level state/consts declared here:** `OVERLAY_ROOT_SELECTOR`, `INERT_SHELL_IDS`, `_lastShellFocus`

#### KEYBOARD ACTIVATION FOR role="button"  
`L40710–40729` (20 lines, 0 functions)


#### GUIDANCE KIT  
`L40730–40983` (254 lines, 20 functions)

- **Functions:** `gkIsDayOne`, `gkRaveModeOn`, `gkEnterScreen`, `gkCanInterrupt`, `gkSpend`, `gkPlurLine`, `showUnlockBanner`, `openZoneSheet`, `closeZoneSheet`, `gkSheetGo`, `gkSheetDismiss`, `gkSheetLater`, `showMoment`, `gkMomentDone`, `fadingTipHTML`, `gkTipAction`, … +4 more
- **Module-level state/consts declared here:** `GK_COLORS`, `GK_TRACKS`, `_gkSession`, `_gkSheet`, `_gkMomentDone`

#### REALMS  
`L40984–41134` (151 lines, 11 functions)

- **Functions:** `realmFound`, `renderRealmTwinkles`, `claimRealm`, `initRealms`, `onPlaceEntered`, `openRealmIntro`, `raveModeUntil`, `startRaveMode`, `endRaveMode`, `expireRaveMode`, `takeRaveModeDiscoveries`
- **Module-level state/consts declared here:** `PAGE_TO_REALM`, `REALM_NAMES`, `REALM_INTROS`, `_realmClaims`, `_realmReoffered`
- **RPCs:** `claim_realm_discovery`

#### HANDLE PICKER  
`L41135–41236` (102 lines, 6 functions)

- **Functions:** `validateHandleFormat`, `isHandleAvailable`, `showHandlePicker`, `hideHandlePicker`, `onHandleInput`, `commitHandle`
- **Module-level state/consts declared here:** `_hpDebounce`, `_hpReady`, `_hpSeq`
- **Tables / buckets (`.from`)**: `ravers`
- **RPCs:** `handle_available`

#### ONBOARDING v2  
`L41240–42343` (1104 lines, 63 functions)

- **Functions:** `hexToRgba`, `showOnboarding`, `obChooseHelp`, `obGoToStep`, `obRenderHaveAccount`, `obDismissExistingMatch`, `obUseExistingAccount`, `obAfterIdentity`, `obLinkAdd`, `obLinkSkip`, `obHandleInput`, `obCheckStep2Ready`, `obStep2Next`, `completeOnboarding`, `addNewMemberFromSearch`, `maybeAdvanceOnboarding`, … +47 more
- **Module-level state/consts declared here:** `OB_GENRE_PICKS`, `_obGenres`, `_obHandleValid`, `_obHandleDebounce`, `_obHandleSeq`, `_openDetailAfterCreate`, `_pendingAddToCrew`, `_pendingAddToFest`, `_notifications`, `PROFILE_LOCKED_IN_MSG`, `POSTFEST_BELL_REMIND_DAYS`, `NOTIF_ALL_GOOD_BTN`, `NOTIF_POINTS_WHY`, `_pendingHuddleDeepLink`, … +8
- **Tables / buckets (`.from`)**: `ravers`, `notifications`, `huddle_messages`
- **RPCs:** `my_phone_matches_other_profile`, `delete_my_account`


### 15. Stats, feedback, NPS/leaderboard, Radar

#### STATS PAGE  
`L42344–42387` (44 lines, 1 functions)

- **Functions:** `getPersonalityLabel`
- **Module-level state/consts declared here:** `PERSONALITY_MAP`, `_statsSelectedCrewId`, `_wrappedStarTaps`, `_wrappedUnlocked`

#### Stats range filter (All Time / Last 12 mo / calendar year)  
`L42388–42482` (95 lines, 11 functions)

- **Functions:** `statsRangeBounds`, `statsPrevBounds`, `statsRangeLabel`, `statsPrevLabel`, `festInBounds`, `festsInStatsRange`, `festsInStatsPrev`, `statsRangeChipsHTML`, `statsRangeCaptionHTML`, `statsDeltaHTML`, `setStatsRange`
- **Module-level state/consts declared here:** `_statsRange`

#### Stats charts (Chart.js) — same destroy-before-create pattern as the PM  
`L42483–42759` (277 lines, 17 functions)

- **Functions:** `drawStatsChart`, `statsChartOrFallback`, `milestoneBarHTML`, `statsHBarConfig`, `wrappedStarTap`, `switchStatTab`, `renderPlurTabTwinkle`, `statsBadgeGroups`, `tile`, `renderStatsPlur`, `byTotal`, `selectCrewForStats`, `myAchievedFests`, `myUpcomingFests`, `myArtistsSeen`, `titleCaseGenre`, … +1 more
- **Module-level state/consts declared here:** `_statsCharts`, `STATS_CHART_MUTED`, `STATS_CHART_GRID`, `STATS_CHART_TOOLTIP`, `MILESTONE_TIER_NAMES`, `MILESTONE_TIER_ICONS`, `MILESTONE_VISIBLE_TIERS`, `_plurRenderSeq`
- **Tables / buckets (`.from`)**: `point_events`

#### MICRO-FEEDBACK PROMPTS  
`L42760–42865` (106 lines, 6 functions)

- **Functions:** `maybeAskMicroFeedback`, `flushQueuedMicroFeedback`, `_askMicroFeedback`, `_renderMicroFeedbackCard`, `submitMicroFeedback`, `dismissMicroFeedback`
- **Module-level state/consts declared here:** `MICRO_FEEDBACK_QUESTIONS`, `MICRO_FEEDBACK_LOOKBACK`, `_microFeedbackShowing`
- **RPCs:** `submit_micro_feedback`

#### CONTACT US (support messages)  
`L42866–42979` (114 lines, 6 functions)

- **Functions:** `openSupportSheet`, `closeSupportSheet`, `pickSupportKind`, `onSupportScreenshotPicked`, `clearSupportScreenshot`, `submitSupportMessage`
- **Module-level state/consts declared here:** `_supportKind`, `_supportShotFile`, `_supportScreen`, `_supportSending`
- **Tables / buckets (`.from`)**: `support-screenshots`
- **RPCs:** `submit_support_message`

#### NPS PROMPT (lightweight, on the Stats page)  
`L42980–43714` (735 lines, 17 functions)

- **Functions:** `maybeShowNPSPrompt`, `renderNPSPromptCard`, `pickNPSScore`, `submitNPS`, `dismissNPSPrompt`, `loadStatsPage`, `sumDays`, `countCities`, `dl`, `renderCrewStats`, `sharedOf`, `citiesOf`, `loadAndRenderPlurLeaderboard`, `plurLeaderboardCardHTML`, `openWrapped`, `closeWrapped`, … +1 more
- **Module-level state/consts declared here:** `_npsSlotChecked`, `_npsPendingScore`, `_plurLbLoadedForCrew`
- **RPCs:** `nps_eligible`, `submit_nps_response`, `get_leaderboard`, `get_my_rank`

#### Radar Share Card — "here's where I'm headed" at a glance  
`L43715–43860` (146 lines, 9 functions)

- **Functions:** `openRadarShareCard`, `closeRadarShareCard`, `omitRaveFromRadarCard`, `restoreRaveToRadarCard`, `resetRadarShareCard`, `rerenderRadarShareCard`, `renderRadarShareCard`, `shareRadarCard`, `showChrome`
- **Module-level state/consts declared here:** `radarShareUpcoming`, `radarShareOmitted`

#### Stats sub-pages: Raves Logged / Days Raved / Cities Hit  
`L43861–44017` (157 lines, 8 functions)

- **Functions:** `backToStats`, `openRavesLoggedPage`, `renderRavesLoggedPage`, `openTicketMixPage`, `renderTicketMixPage`, `backToStatsFromTicketMix`, `openRavesRadarPage`, `renderRavesRadarPage`

#### Radar Map (Raves on Your Radar)  
`L44018–45147` (1130 lines, 58 functions)

- **Functions:** `cleanupRadarMap`, `watchRadarPageLeave`, `renderRavesRadarMap`, `restartRadarJourney`, `renderRadarMapEmptyState`, `declutterRadarPoints`, `buildRadarMap`, `revealMarker`, `relayout`, `drawLeg`, `settle`, `prefersReducedMotion`, `afterRadarMove`, `go`, `flyThroughRadarPoints`, `alive`, … +42 more
- **Module-level state/consts declared here:** `radarMapInstance`, `radarRafId`, `radarPathRafId`, `radarResizeObserver`, `radarLeaveObserver`, `radarCanvasEl`, `radarMapLastPoints`, `RADAR_VIEW_PADDING`, `_artistsSeenGenreFilter`, `DAY_NAMES`, `MONTH_NAMES`, `CITY_GEOCODE_CACHE_KEY`

## D. Indexes

| Table / bucket | Sections that touch it |
|---|---|
| `alert_preferences` | NATIVE PUSH (iOS app); MODERATION: my warnings & restrictions |
| `artist_festival_appearances` | MOD DASHBOARD: Set times tab; MISSION BRIEFING; Canonical artists (sourced from lineup; Rave lineup tagging (shared lineup + p |
| `artists` | Lineup Explorer picks handoff; MOD DASHBOARD: Missing Genres tab; Canonical artists (sourced from lineup |
| `audit_logs` | SOFT DELETE & AUDIT HELPERS |
| `community_genres` | Community genre pool; Tag Sheet |
| `crew_achievements` | FAM PINS |
| `crew_archive_links` | The Archive |
| `crew_feature_reads` | CREW FEED (beta crew page) |
| `crew_feed_events` | FAM PINS |
| `crew_jam_vibes` | FAM Jams |
| `crew_jams` | FAM Jams |
| `crew_members` | SUPABASE WRITE HELPERS; FAM PINS |
| `crew_membership_blocks` | Rave Focus popup |
| `crew_plan_templates` | GAME PLAN |
| `crew_poll_votes` | FAM Poll |
| `crew_polls` | FAM Poll |
| `crews` | Lineup Explorer picks handoff; SUPABASE WRITE HELPERS; PHOTO HELPERS; Crew invite link |
| `device_push_tokens` | NATIVE PUSH (iOS app) |
| `dream_board_pins` | Dream Board |
| `email_preferences` | NATIVE PUSH (iOS app); MODERATION: my warnings & restrictions; DELETE ACCOUNT |
| `festival-maps` | Rave editor (create / edit / delete a  |
| `festival_rsvp_blocks` | Rave Focus popup |
| `festival_vibes` | Festival Vibe Bubbles |
| `festivals` | Lineup Explorer picks handoff; SUPABASE WRITE HELPERS; Shareable Rave Card (Gig Poster); Rave editor (create / edit / delete a ; Going Options bottom sheet |
| `flags` | MODERATION: flags/reports data layer |
| `game_plan_items` | CREW FEED (beta crew page); GAME PLAN; MISSION BRIEFING; Nearby raves (distance filter) |
| `game_plans` | CREW FEED (beta crew page); GAME PLAN; MISSION BRIEFING; Nearby raves (distance filter) |
| `huddle-gifs` | MOD DASHBOARD |
| `huddle-media` | HUDDLE GIFS |
| `huddle_gif_favorites` | HUDDLE GIFS |
| `huddle_gif_pack` | MOD DASHBOARD; HUDDLE GIFS |
| `huddle_messages` | PHOTO HELPERS; CREW LIST ROWS (Crews tab accordion); HUDDLE; HUDDLE GIFS; GAME PLAN; MISSION BRIEFING; ONBOARDING v2 |
| `huddle_room_reads` | CREW LIST ROWS (Crews tab accordion); HUDDLE |
| `huddle_rooms` | CREW LIST ROWS (Crews tab accordion); HUDDLE; GAME PLAN |
| `lineup_share_links` | MODERATION: my warnings & restrictions |
| `met_stories` | PLUR POINTS |
| `moderators` | SUPABASE INIT |
| `notifications` | NOTIFICATION DB HELPERS; ONBOARDING v2 |
| `our_photos` | PHOTO HELPERS |
| `photos` | PHOTO HELPERS; DELETE ACCOUNT |
| `point_event_types` | PLUR POINTS |
| `point_events` | Lineup Explorer picks handoff; PLUR POINTS; VENDOR VILLAGE; Top 3 sets ("What were your top 3 sets; Nearby raves (distance filter); Stats charts (Chart.js) |
| `point_tiers` | PLUR POINTS |
| `private_phones` | PHOTO HELPERS |
| `push_subscriptions` | DELETE ACCOUNT |
| `raver_achievements` | FAM PINS |
| `raver_artist_plans` | Lineup Explorer picks handoff; Canonical artists (sourced from lineup; Rave lineup tagging (shared lineup + p |
| `raver_artist_sightings` | Canonical artists (sourced from lineup; Rave lineup tagging (shared lineup + p |
| `raver_clash_choices` | Set reminders from the app (fest-week  |
| `raver_favorite_artists` | SUPABASE WRITE HELPERS |
| `raver_festival_interest` | SUPABASE WRITE HELPERS; FAM PINS |
| `raver_festivals` | SUPABASE WRITE HELPERS; FAM PINS |
| `raver_nicknames` | PHOTO HELPERS |
| `raver_postfest_checkoffs` | Canonical artists (sourced from lineup; Post-fest check-off ("Who'd you catch? |
| `raver_top_sets` | Canonical artists (sourced from lineup |
| `ravers` | Lineup Explorer picks handoff; SUPABASE WRITE HELPERS; PHOTO HELPERS; Nearby raves (distance filter); HANDLE PICKER; ONBOARDING v2 |
| `saved_vendors` | VENDOR VILLAGE |
| `set_meetups` | GAME PLAN |
| `set_reminder_optins` | WELCOME BACK POPUP |
| `set_time_reports` | MOD DASHBOARD: Set times tab |
| `support-screenshots` | PM METRICS DASHBOARD (super-admin only; CONTACT US (support messages) |
| `user_blocks` | BLOCKING: one raver blocks another |
| `vendor_festival_tags` | VENDOR VILLAGE |
| `vendor_raver_badges` | VENDOR VILLAGE |
| `vendor_reviews` | VENDOR VILLAGE |
| `vendor_spots` | VENDOR VILLAGE |
| `vendor_vibe_tags` | VENDOR VILLAGE |
| `vendors` | VENDOR VILLAGE |
| `venue_reviews` | VENUE DIRECTORY |
| `venues` | VENUE DIRECTORY |
| `viewer_notes` | PHOTO HELPERS |

| RPC | Called from |
|---|---|
| `ack_sanction` | MODERATION: my warnings & restrictions |
| `claim_and_merge_raver` | Lineup Explorer picks handoff |
| `claim_realm_discovery` | REALMS |
| `create_countdown_link` | NATIVE COUNTDOWN WIDGET (iOS home/lock; HOME SCREEN COUNTDOWN |
| `delete_my_account` | DELETE ACCOUNT; ONBOARDING v2 |
| `disconnect_raver` | PHOTO HELPERS |
| `find_raver_by_invite_code` | Lineup Explorer picks handoff |
| `get_admin_android_beta` | PM METRICS DASHBOARD (super-admin only |
| `get_claim_preview` | APP SHOW / HIDE; Lineup Explorer picks handoff |
| `get_countdown` | NATIVE COUNTDOWN WIDGET (iOS home/lock |
| `get_crew_by_invite_token` | APP SHOW / HIDE; Lineup Explorer picks handoff |
| `get_crew_history` | HISTORY / ACTIVITY VIEWS |
| `get_crewmate_ravers` | Lineup Explorer picks handoff |
| `get_explorer_metrics` | PM METRICS DASHBOARD (super-admin only |
| `get_festival_history` | HISTORY / ACTIVITY VIEWS |
| `get_founding_testers` | ANDROID BETA WAITLIST |
| `get_leaderboard` | NPS PROMPT (lightweight, on the Stats  |
| `get_lineup_crew_votes` | Set reminders from the app (fest-week  |
| `get_lineup_set_times` | Set reminders from the app (fest-week  |
| `get_mission_briefing_metrics` | PM METRICS DASHBOARD (super-admin only |
| `get_my_rank` | NPS PROMPT (lightweight, on the Stats  |
| `get_own_and_created_ravers` | Lineup Explorer picks handoff |
| `get_pm_dashboard_metrics` | PM METRICS DASHBOARD (super-admin only |
| `get_raver_history` | HISTORY / ACTIVITY VIEWS |
| `get_raver_points` | PLUR POINTS |
| `get_support_inbox` | PM METRICS DASHBOARD (super-admin only |
| `handle_available` | HANDLE PICKER |
| `is_super_admin` | PM METRICS DASHBOARD: super-admin gate |
| `join_android_beta` | ANDROID BETA WAITLIST |
| `join_crew_via_invite` | Crew invite link |
| `leave_android_beta` | ANDROID BETA WAITLIST |
| `log_analytics_event` | SUPABASE INIT |
| `log_client_error` | SUPABASE INIT |
| `log_pageview` | SUPABASE INIT |
| `mod_flag_context` | MODERATION: flags/reports data layer |
| `mod_issue_sanction` | MODERATION: flags/reports data layer |
| `mod_resolve_flag` | MODERATION: flags/reports data layer |
| `mod_revoke_sanction` | MODERATION: flags/reports data layer |
| `my_android_beta` | ANDROID BETA WAITLIST |
| `my_phone_matches_other_profile` | ONBOARDING v2 |
| `my_sanctions` | MODERATION: my warnings & restrictions |
| `nps_eligible` | NPS PROMPT (lightweight, on the Stats  |
| `purge_raver_data` | FAM PINS — Crew Achievements |
| `register_device_push_token` | NATIVE PUSH (iOS app) |
| `request_leave_crew` | FAM PINS — Crew Achievements |
| `resolve_crew_leave_request` | Rave Focus popup — RSVPs + lineup for  |
| `review_set_time` | MOD DASHBOARD: Set times tab |
| `revoke_countdown_link` | HOME SCREEN COUNTDOWN |
| `set_android_beta_status` | PM METRICS DASHBOARD (super-admin only |
| `set_set_reminders` | Set reminders from the app (fest-week  |
| `set_support_message_status` | PM METRICS DASHBOARD (super-admin only |
| `set_top_sets` | Top 3 sets ("What were your top 3 sets |
| `submit_micro_feedback` | MICRO-FEEDBACK PROMPTS |
| `submit_nps_response` | NPS PROMPT (lightweight, on the Stats  |
| `submit_support_message` | CONTACT US (support messages) |
| `toggle_crew_feed_reaction` | CREW FEED (beta crew page) |
| `turn_off_share_link` | MODERATION: my warnings & restrictions |
