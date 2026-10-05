# What's new in RaveFAM 2.7–2.9: 3 Instagram posts

Three single-image feed posts (4:5, 1080×1350 PNG), one per recent release. They can also run as one 3-slide carousel in this order.

- **Screenshots:** real app screens captured at iPhone 13 size on the stubbed test backend with demo data (Kai, Sam and the Bass Syndicate crew are not real users). Capture script: `_build/capture.spec.js`. Slide builder: `_build/slides.mjs`.
- **Style:** matches `marketing/hulaween-2026` (same background, Orbitron headlines, footer).
- **Link in bio:** `https://myravefam.com`

| # | Release | Feature | Image |
|---|---|---|---|
| 1 | 2.9.0 | Tabbed raver profiles | `post1-profiles.png` |
| 2 | 2.8.0 | Grouped notification inbox | `post2-inbox.png` |
| 3 | 2.7.0 | Settings hub | `post3-settings.png` |

---

## Post 1 · "Your fam, at a glance" (2.9)

**Caption**

> Raver profiles got a glow-up ✨
>
> Every profile now has tabs: **Raves**, **Vibe**, **Crews** and **Us**. Open a crewmate's profile and see every rave you're both going to, how long until the next one, and add yourself with one tap on ➕ Me too.
>
> Looking after someone's profile? The new Manage raves sheet suggests raves to add, or lets you add and remove them yourself.
>
> Who's on your "going together" list this season? 👇
>
> #RaveFam #PLUR #RaveFamily #FestivalSeason #EDMFamily #RaveCrew #FestivalFriends #Raver

**Alt text:** "Your fam, at a glance" headline above Kai's profile in RaveFAM, with tabs for Raves, Vibe, Crews and Us. The Raves tab says "You and Kai are both going to 2 raves" and lists Hulaween in 3 weeks and Tomorrowland in 10 months, each tagged "You're going too".

## Post 2 · "Less noise. More vibes." (2.8)

**Caption**

> Your notifications, finally sorted 🔔
>
> Anything that needs a decision is pinned under **Needs you** until you deal with it. Everything else is grouped into Today, This week and Earlier. When three crewmates RSVP to the same rave, you get one row, not three.
>
> Use the tabs to filter by Crew, Raves, Mentions or PLUR.
>
> Less scrolling, more time for the dance floor 💃🕺
>
> #RaveFam #PLUR #RaveLife #FestivalSeason #RaveCrew #EDMCommunity #FestivalPrep

**Alt text:** "Less noise. More vibes." headline above the RaveFAM notification inbox. Filter tabs show All 4, Crew 2, Raves 1, Mentions and PLUR 1. A pinned "Needs you" card says "Kai added you to Hulaween!" with buttons to leave the lineup, block future adds or say "All good". Under "Today" is one row: "Kai M. and 1 other RSVP'd to Tomorrowland".

## Post 3 · "Your rules. One place." (2.7)

**Caption**

> New Settings hub ⚙️
>
> Notifications, privacy, safety and your login now each have their own page, and the hub shows where each one stands at a glance: "3 of 5 on", "Phone hidden", "No one blocked".
>
> Your phone number, who can add you to raves, and who you've blocked are all a tap away. A safe dance floor starts with you 🛡️💖
>
> #RaveFam #PLUR #RaveSafe #FestivalSafety #RaveFamily #FestivalSeason #SafeSpace

**Alt text:** "Your rules. One place." headline above the RaveFAM Settings hub: a profile card with "Edit profile", then rows for Notifications (3 of 5 on), Privacy (Phone hidden), Safety (No one blocked · PLUR Code) and Account & login (Email login · reset tips).

---

## Rebuilding

From the repo root, with `@playwright/test` installed:

```sh
npx playwright test -c <config pointing at marketing/whats-new-2-9/_build/capture.spec.js>   # writes the raw screens
node marketing/whats-new-2-9/_build/slides.mjs                                                # renders the slides
```

The slide builder expects the Orbitron, Space Grotesk and Urbanist fonts in `_build/fonts/local.css` (Google Fonts, not committed, same as the Hulaween build). Output paths inside both scripts point at the scratch folder they were made in, so update them before rerunning.
