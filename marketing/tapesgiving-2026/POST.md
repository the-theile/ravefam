# Tapesgiving × RaveFAM: crew-planning carousel

- **Format:** 4:5 feed carousel, 1080×1350 PNG, `slide1.png` to `slide5.png`
- **When:** this week or next, before Fri Nov 27. Evening (6–8 PM ET).
- **Link in bio:** `https://myravefam.com/lineup-explorer/tapesgiving-2026`

## Where the data comes from
- **Tapesgiving:** the live `festivals` row (slug `tapesgiving-2026`): Fri Nov 27 2026, 2 days, Clearwater, Florida.
- **Lineup (verified Nov 17 2026):** Supabase `artist_festival_appearances` for that festival has 9 rows: Tape B ×2 (one per night), EAZYBAKED, Distinct Motive, Space Wizard, Claybrook, G Jones, Moody Good, Dr. Ushuu. The Explorer page shows those as 8 cards ("EAZYBAKED b2b Distinct Motive" is one card). No set times are published yet (`start_at`/`stage` all null), so the page shows none and the slides don't claim any.
- **Slides 1–2:** the real Tapesgiving 2026 Lineup Explorer page (`lineup-explorer/tapesgiving-2026.html`), logged out, nothing seeded, captured from the repo at commit 274105f. The CTA bar was dismissed with its own ✕ button.
- **Slides 3–4:** real `app.html` UI on the stubbed harness from `scripts/capture-landing-screenshots.js`. The crew (Vibe Tribe), names and avatars are the fictional demo crew the landing page and guide already use, with no real user data. Every avatar is an illustrated stand-in, never a photo. The crew's upcoming rave is the real Tapesgiving row. The meetup poll, its options and its votes are demo content, the same way the guide shows a demo poll.

## Before posting
Open the live page on your phone and check it still shows the same 8 cards as slide 2. The cloud session that built this couldn't load myravefam.com through its network proxy, so the check above compared Supabase with the repo copy of the page, not the deployed one. If the lineup or set times change, rerun the build (below).

## Caption

> Who's your Tapesgiving crew? 🔊 Tape B's hometown takeover, The BayCare Sound, Clearwater. Nov 27–28.
>
> Tape B both nights, plus G Jones, Moody Good, Space Wizard, EAZYBAKED b2b Distinct Motive, Claybrook and Dr. Ushuu. The whole lineup is on our free Lineup Explorer. No login.
>
> Then start a crew, see who's going, and settle "where we meeting?" with one poll instead of 200 texts.
>
> Free on the App Store. Link in bio.
>
> Tag your Tapesgiving crew 👇

**Hashtags:** #Tapesgiving #TapeB #GJones #MoodyGood #SpaceWizard #Riddim #BassMusic #Clearwater #TampaBay #FloridaRaves #RaveFam #PLUR

## Alt text
1. "Who's your Tapesgiving crew?" in neon over a phone showing the Tapesgiving 2026 Lineup Explorer page: Tape B presents, Nov 27–28, The BayCare Sound, Clearwater FL.
2. "The full lineup, one tap away." A phone showing the Lineup Explorer cards: Tape B (Friday headliner), EAZYBAKED b2b Distinct Motive, Space Wizard, Claybrook. A green sticker reads "Free. No login."
3. "Whole crew. One page." Two phones: a crew page with the Tapesgiving rave plan (10 days, 8 going), and the crew roster.
4. "Where we meeting?" A crew poll, "Meetup spot before Tape B Friday?", with Sound booth winning at 67%.
5. "Your crew. One plan." The Download on the App Store badge and "Link in bio".

## Rebuild
From the repo root (Playwright resolvable as `playwright` and `@playwright/test`; set `PW_CHROMIUM` to a Chromium binary if Playwright's bundled one isn't installed):
1. `node marketing/tapesgiving-2026/_build/capture.js` (starts its own static server)
2. `node marketing/tapesgiving-2026/_build/slides.mjs`

`_build/appstore-badge.svg` is Apple's official badge from developer.apple.com. Don't modify it.
