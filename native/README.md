# RaveFAM iOS app (Capacitor)

The iOS app is a Capacitor shell that loads the live site (`https://myravefam.com/app`,
see `capacitor.config.json`). Web deploys update the app without an App Store release;
only native changes (plugins, permissions, icons) need a new build.

- `native/www/` — offline fallback page bundled into the app (shown when the site can't load).
- `ios/` — Xcode project (Swift Package Manager, no CocoaPods). Bundle ID `com.myravefam.app`.
  `ios/App/ShareExtension` is the share-sheet extension (see "Share to RaveFAM" below).
- `.well-known/apple-app-site-association` — Universal Links (`/app`, `/app.html`, `/rave/*`).
  Team ID: `49RV4NFK6S`.

After changing `capacitor.config.json` or adding a plugin: `npm run ios:sync`.

## Push notifications (iOS)
The app registers with Apple Push Notification service through
`@capacitor/push-notifications`; tokens land in `device_push_tokens` via
`register_device_push_token()`. The push edge functions (beacon, mention, set
reminders, lineup alerts) send to them with `supabase/functions/_shared/apns.ts`.
Set these Supabase Edge Function secrets (Dashboard -> Edge Functions -> Secrets):

- `APNS_KEY`: full text of the APNs `.p8` key (Certificates, IDs & Profiles -> Keys)
- `APNS_KEY_ID`: that key's Key ID
- `APNS_TEAM_ID`: `49RV4NFK6S`

Without them, web push keeps working and iOS pushes are skipped.

## Share to RaveFAM (share sheet)
`ShareExtension` (iOS share sheet → RaveFAM) accepts one web link and/or text, writes
`share-inbox.json` (`{ url?, text?, at }`, newest share wins) to the App Group container and shows
a "Saved" card. `App/ShareInboxPlugin.swift` (registered in `SceneDelegate.swift`) exposes it as
`Capacitor.Plugins.ShareInbox.read()` / `.clear()`. `app.html` checks on boot and whenever the app
comes back to the foreground, asks which Huddle, and opens that room with the share in the composer.
Instagram, TikTok and Facebook share a post link, not the media.

## Rave Countdown widget
`CountdownWidget` (WidgetKit, iOS 17+) shows days until a crew's next rave. `app.html`
(`syncCountdownWidget`) sends each crew's next raves to `App/CountdownWidgetPlugin.swift`
(`Capacitor.Plugins.CountdownWidget.save({ json })` / `.clear()`), which writes `countdown.json`
(`{ token?, savedAt, crews }`) to the App Group and reloads the widget. Between app opens the widget
refetches with the raver's personal countdown token from `/countdown/<token>?json=1`
(`api/countdown.js`, `get_countdown` RPC). Day maths lives in `CountdownModel.swift` and mirrors
`countdownState()` in `api/countdown.js`. Keep the two in step.

## Builds
Run **Actions -> iOS TestFlight -> Run workflow** on `main`.

## Releases
Web changes reach the app on deploy; only native changes (Swift, `capacitor.config.json`,
plugins, entitlements, Info.plist, icons) need an App Store submission. Those are batched:

- Merge native changes to `main` as they're ready and push a TestFlight build to test on device.
- Every 2–3 weeks, if the list below has anything, submit the latest tested TestFlight build
  for review and move the list into **Released**. Skip the cycle if it's empty.
- Crashes or a broken core flow (sign-in, push) ship right away (expedited review if needed).

The App Store version is `APP_VERSION` at build time, so released versions skip numbers.

### Next iOS release
Each native PR adds a line here; **After release** holds web changes that wait on it.

- Lineup Explorer and other myravefam.com pages stay in the app's webview (`server.allowNavigation`) (#387)
- Edge swipe-back on pages outside `/app` (#386, #387)
- Haptic taps as each rave pops in on the Radar Map, plus a success tap at the end (`@capacitor/haptics`)
  - Since 2.15.0 the web side also taps on RSVPs, votes, reactions, Huddle sends, tab switches,
    claims and errors, with a Settings → Haptics switch; all of it no-ops until this build ships
- Privacy manifest (`PrivacyInfo.xcprivacy`) declares the data the app collects; App Store Connect's
  App Privacy answers must match it
- `UIRequiredDeviceCapabilities` is `arm64` (was the template's `armv7`)
- Native location (`@capacitor/geolocation`): Nearby raves asks for location once instead of twice
  (app prompt + webview's "myravefam.com would like your location"). Since 2.16.0 the web side
  uses it when present and falls back to the browser API on older builds
  - `NSLocationAlwaysAndWhenInUseUsageDescription` added to Info.plist (ITMS-90683 on 2.16.0 build 9:
    the plugin references the "Always" API even though the app only asks for When In Use)
- One window on launch: Info.plist no longer names `Main` as the scene/main storyboard, so UIKit stops
  building a second window (with its own bridge) beside `SceneDelegate`'s. Likely fix for the iPad rejection
  (2.1(a), iPad Air 11" on iPadOS 27: "unresponsive when tapping anywhere")
- Privacy manifest declares Search History (Huddle GIF search terms sent to GIPHY, not linked);
  add the same to App Store Connect's App Privacy answers
- Share to RaveFAM from the iOS share sheet: new `ShareExtension` target (`ios/App/ShareExtension`,
  bundle ID `com.myravefam.app.ShareExtension`) saves a shared link/text to the App Group
  `group.com.myravefam.app`; the local `ShareInboxPlugin` hands it to the web side, which asks which
  Huddle to drop it in (`checkShareInbox` in `app.html`, since 2.36.0; no-ops on older builds)
  - Both App IDs need the App Groups capability with `group.com.myravefam.app`. Automatic signing in the
    TestFlight workflow should register them; if the archive fails on provisioning, add the group under
    Certificates, IDs & Profiles → Identifiers → App Groups and tick it on both App IDs, then re-run
- Rave Countdown widget: new `CountdownWidget` target (`ios/App/CountdownWidget`, bundle ID
  `com.myravefam.app.CountdownWidget`, iOS 17+; the app itself stays on iOS 15). Home small / medium /
  large, lock screen circular / rectangular / inline, StandBy; long-press → Edit Widget → Crew pins a crew.
  The local `CountdownWidgetPlugin` writes `countdown.json` to the App Group (`syncCountdownWidget` in
  `app.html`, since 2.39.0; no-ops on older builds); the widget refreshes from
  `/countdown/<token>?json=1` every few hours and rolls the count over at local midnight
  - The new App ID needs the same App Groups capability (`group.com.myravefam.app`); same fix as above
    if the archive fails on provisioning

**After release**
- Re-add `/lineup-explorer` and `/lineup-explorer/*` to `.well-known/apple-app-site-association`
  (removed in #387: older builds bounce those links to Safari)
- Move "Delete my account" from the Settings hub into Settings → Account & login
  (kept on the hub during review), and update the path in `privacy.html` (s8),
  `terms.html`, `contact.html` and the in-app help FAQ (`delete-account`)
- `countdown-guide.html`: drop the "No RaveFAM in the widget list?" Scriptable card (`#scriptable`)
  once the countdown widget is out

### Released
_Nothing tracked yet. The build in review predates this list._
