# RaveFAM

## Versioning

The app displays its version in the Settings modal (Privacy & Notifications),
sourced from `APP_VERSION` in `app.html` (search "APP_VERSION").

On any meaningful change to `app.html`, bump `APP_VERSION` using semantic
versioning (MAJOR.MINOR.PATCH):
- PATCH — bug fixes, visual tweaks
- MINOR — new features, non-breaking additions
- MAJOR — breaking changes or major overhauls

Keep the `version` field in `package.json` in sync with `APP_VERSION` —
they should always match.
