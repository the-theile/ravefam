# RaveFAM iOS app (Capacitor)

The iOS app is a Capacitor shell that loads the live site (`https://myravefam.com/app`,
see `capacitor.config.json`). Web deploys update the app without an App Store release;
only native changes (plugins, permissions, icons) need a new build.

- `native/www/` — offline fallback page bundled into the app (shown when the site can't load).
- `ios/` — Xcode project (Swift Package Manager, no CocoaPods). Bundle ID `com.myravefam.app`.
- `.well-known/apple-app-site-association` — Universal Links (`/app`, `/app.html`, `/rave/*`).
  Replace `TEAMID` with the Apple Developer Team ID before links will open the app.

After changing `capacitor.config.json` or adding a plugin: `npm run ios:sync`.
