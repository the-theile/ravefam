# High Bloom 11.21 × RaveFAM: crew-planning carousel

- **Format:** 4:5 feed carousel, 1080×1350 PNG, `slide1.png` to `slide5.png`
- **When:** this week, before Sat Nov 21. Evening (6–8 PM ET).
- **Link in bio:** `https://myravefam.com/lineup-explorer/high-bloom-2026`

## Where the data comes from
- **High Bloom:** the live `festivals` row: Sat Nov 21 2026, 1 day, Port Charlotte, Florida (slug renamed to `high-bloom-2026` to match the page).
- **Lineup:** the 7 acts billed on the official Eventbrite page (Dab Day Productions × HippieStock), in billing order: Dirt Monkey, Kash'd Out, WonkyWilla (billed "Wonky Willa"), Badda Skat, Dionysus, The Hulagans (billed "The Hulagan's"), Kairo Reef. No set times have been posted.
- **Slide 2:** the real High Bloom 2026 Lineup Explorer page (`lineup-explorer/high-bloom-2026.html`), logged out, nothing seeded.
- **Slides 3–4:** real `app.html` UI on the stubbed harness from `scripts/capture-landing-screenshots.js`. The crew, names and avatars are the fictional demo crew the landing page and guide already use (no real user data). The crew's upcoming rave is the real High Bloom row with its real 7-act lineup. The "Who's driving?" poll, its options and its votes are demo content, the same way the guide shows a demo poll.

## Caption

> High Bloom is Saturday 🌸 Port Charlotte, 11.21.
>
> Dirt Monkey, Kash'd Out, WonkyWilla, Badda Skat, Dionysus, The Hulagans and Kairo Reef. The full lineup is on the Lineup Explorer now, so dig in before Saturday.
>
> Then start a crew, tap Going, and settle "who's driving?" with one poll instead of 200 texts.
>
> Free on the App Store or at myravefam.com. Link in bio.
>
> Tag who's riding with you 👇

**Hashtags:** #HighBloom #DirtMonkey #KashdOut #WonkyWilla #PortCharlotte #FloridaRaves #SWFL #RaveCrew #FestivalFriends #RaveFam #PLUR

## Alt text
1. Neon title card: "High Bloom 11.21", Sat Nov 21, Port Charlotte FL.
2. "Dig the lineup before you go." Two phones showing the High Bloom 2026 Lineup Explorer: the page header, and the 7 acts with Dirt Monkey starred at the top of the bill.
3. "Start a crew. See who's going." The Create New Crew form next to the High Bloom RSVP sheet showing 8 crewmates going.
4. "Who's driving?" A crew poll with seat options and live vote results.
5. "Your crew. One plan." Download on the App Store badge and myravefam.com.

## Rebuild
From the repo root (Playwright resolvable as `playwright` and `@playwright/test`):
1. `node marketing/high-bloom-2026/_build/capture.js` (starts its own static server; pass a shot name to redo just one)
2. `node marketing/high-bloom-2026/_build/slides.mjs`

`_build/appstore-badge.svg` is Apple's official badge from developer.apple.com. Don't modify it.
