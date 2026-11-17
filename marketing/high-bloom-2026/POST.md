# High Bloom 11.21 × RaveFAM: crew-planning carousel

- **Format:** 4:5 feed carousel, 1080×1350 PNG, `slide1.png` to `slide5.png`
- **When:** this week, before Sat Nov 21. Evening (6–8 PM ET).
- **Link in bio:** `https://myravefam.com`

## Where the data comes from
- **High Bloom:** the live `festivals` row: Sat Nov 21 2026, 1 day, Port Charlotte, Florida. It has **0 acts** and no Lineup Explorer page, so no High Bloom lineup appears anywhere in the carousel.
- **Slide 2:** the real Tapesgiving 2026 Lineup Explorer page (`lineup-explorer/tapesgiving-2026.html`, The BayCare Sound, Clearwater, Nov 27–28). It's the nearest Florida rave with a posted lineup. Logged out, nothing seeded, nothing edited. The copy on the slide says High Bloom's lineup isn't out yet.
- **Slides 3–4:** real `app.html` UI on the stubbed harness from `scripts/capture-landing-screenshots.js`. The crew, names and avatars are the fictional demo crew the landing page and guide already use (no real user data). The crew's upcoming rave is the real High Bloom row. The "Who's driving?" poll, its options and its votes are demo content, the same way the guide shows a demo poll.

## Caption

> High Bloom is Saturday 🌸 Port Charlotte, 11.21.
>
> Start a crew, tap Going, and settle "who's driving?" with one poll instead of 200 texts. When the lineup drops, it lands on the Lineup Explorer.
>
> Free on the App Store or at myravefam.com. Link in bio.
>
> Tag who's riding with you 👇

**Hashtags:** #HighBloom #PortCharlotte #FloridaRaves #SWFL #RaveCrew #FestivalFriends #RaveFam #PLUR

## Alt text
1. Neon title card: "High Bloom 11.21", Sat Nov 21, Port Charlotte FL.
2. "Dig the lineup before you go." Two phones showing the Tapesgiving 2026 Lineup Explorer: the header and the list of artists (Tape B, EAZYBAKED b2b Distinct Motive, Space Wizard, Claybrook).
3. "Start a crew. See who's going." The Create New Crew form next to the High Bloom RSVP sheet showing 8 crewmates going.
4. "Who's driving?" A crew poll with seat options and live vote results.
5. "Your crew. One plan." Download on the App Store badge and myravefam.com.

## Rebuild
From the repo root (Playwright resolvable as `playwright` and `@playwright/test`):
1. `node marketing/high-bloom-2026/_build/capture.js` (starts its own static server; pass a shot name to redo just one)
2. `node marketing/high-bloom-2026/_build/slides.mjs`

`_build/appstore-badge.svg` is Apple's official badge from developer.apple.com. Don't modify it.
