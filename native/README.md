# RaveFAM iOS app (Capacitor)

The iOS app is a Capacitor shell that loads the live site (`https://myravefam.com/app`,
see `capacitor.config.json`). Web deploys update the app without an App Store release;
only native changes (plugins, permissions, icons) need a new build.

- `native/www/` — offline fallback page bundled into the app (shown when the site can't load).
- `ios/` — Xcode project (Swift Package Manager, no CocoaPods). Bundle ID `com.myravefam.app`.
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

**After release**
- Re-add `/lineup-explorer` and `/lineup-explorer/*` to `.well-known/apple-app-site-association`
  (removed in #387: older builds bounce those links to Safari)

### Released
_Nothing tracked yet. The build in review predates this list._
