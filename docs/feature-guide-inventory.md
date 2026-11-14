# Feature Guide — Feature Inventory (draft for review)

Source for `guide.html`. Built from `app.html` section headers, the in-app
App Guide overview, and `HELP_ARTICLES` (Help Center). Names use the
**UI wording** (e.g. "Rave Plan", not the internal "Game Plan").

Tags: **LIVE** · **BETA** · **iOS** (iOS app only) · **SOON** (not shipped yet)
`app.html` refs are the `// ===== SECTION =====` headers.

---

## 1. Getting in — `#join`
| Feature | What it is | Tag | app.html section |
|---|---|---|---|
| Passwordless login | Email 6-digit code or magic link — no password | LIVE | PASSWORDLESS AUTH |
| Phone login | SMS code sign-in | LIVE | SMS AUTH |
| Second way in | Link email + phone to the same account | LIVE | LOGIN METHOD LINKING |
| Pick your handle | Claim your @handle at signup | LIVE | HANDLE PICKER |
| Onboarding | Guided setup: sound, vibes, first crew | LIVE | ONBOARDING v2 |
| Claim your spot | Scan a QR / open an invite link → claim the profile a crew lead saved for you, review details first | LIVE | QR Claim flow |
| Free | Free to sign up and use, no card | LIVE | — |

## 2. Crews — `#crews`
| Feature | What it is | Tag | app.html section |
|---|---|---|---|
| Crews | Your fam's home base; lead or join unlimited crews | LIVE | Crew data model / CREW LIST ROWS |
| Secret → Recruiting → Locked In | Crew modes: build quietly, open invites, then lock it | LIVE | Crew detail view |
| Unclaimed profiles | Add ravers before they've signed up | LIVE | Crew Pick Dialog / Invite Prompt |
| Invite link + QR | Shareable invite to claim a saved spot | LIVE | Crew invite link |
| Crew totem | Crew photo/emblem used on cards & invites | LIVE | PHOTO HELPERS |
| Rename + recolour | Make the crew yours | LIVE | Crew Edit |
| "Here now" glow | Crew row glows when a crewmate is in its Huddle/Rave Plan (privacy toggle) | LIVE | CREW PRESENCE |
| Crew Card (Rave Pass) | Shareable laminate of the roster or who's going next | LIVE | Shareable Crew Card |
| FAM Pins | Crew achievements / badges with progress | LIVE | FAM PINS |
| Crew History | Activity timeline for the crew | LIVE | Crew History |

## 3. Huddle — `#huddle`
| Feature | What it is | Tag | app.html section |
|---|---|---|---|
| Crew chat | Real-time group chat per crew + one per rave | LIVE | HUDDLE |
| Replies, @mentions, GIFs | Everyday chat tools | LIVE | HUDDLE / HUDDLE GIFS |
| Beacon | Urgent ping that cuts through ("lost at the fest") | LIVE | HUDDLE |
| Search & jump | Search all rooms/crews, filter by room or person, jump to message | LIVE | HUDDLE |
| Share to RaveFAM | Share from Instagram/TikTok/Safari straight into a Huddle | iOS | NATIVE SHARE INBOX |

## 4. Rave Plan — `#rave-plan`
| Feature | What it is | Tag | app.html section |
|---|---|---|---|
| Rave Plan board | Auto-created when 2+ crewmates are going to the same rave | LIVE | GAME PLAN |
| Tasks | Phased to-dos anyone can claim | LIVE | GAME PLAN |
| Roles | Driver, navigator, vibe curator… | LIVE | GAME PLAN |
| Rides | Post a car, crewmates claim seats | LIVE | GAME PLAN |
| Stay | Post lodging, open spots to claim | LIVE | GAME PLAN |
| Outfit | Theme + photo references | LIVE | GAME PLAN |
| Lineup + set meetups | Set-time lineup, who's catching what, 📍 meet spots | LIVE | GAME PLAN |
| Mission Briefing | Swipeable 8-page case-file deck over the plan, live-synced | LIVE | MISSION BRIEFING |

## 5. Crew hangout extras — `#crew-extras`
| Feature | What it is | Tag | app.html section |
|---|---|---|---|
| Dream Board | Pin the raves/artists the crew dreams of hitting | LIVE | Dream Board |
| FAM Poll | Crew polls + poll-of-the-day prompts | LIVE | FAM Poll |
| FAM Jams | Share tracks (Spotify/Apple/YouTube Music), react | LIVE | FAM Jams |
| The Archive | Crew photo-drop links per rave | LIVE | The Archive |

## 6. Raves — `#raves`
| Feature | What it is | Tag | app.html section |
|---|---|---|---|
| Raves catalog | Browse festivals & local shows; card or list view | LIVE | Raves tab / card vs list |
| Going / Interested + ticket type | RSVP sheet incl. ticket type | LIVE | Going Options |
| Nearby raves | Distance filter; your location stays on-device | LIVE | Nearby raves |
| Rave weather | Forecast for raves ≤15 days out | LIVE | Rave weather |
| Add / edit raves + venues | Crowd-sourced catalog with venue picker | LIVE | Rave editor / venue picker |
| Venue Directory | Browse, add and review venues | LIVE | VENUE DIRECTORY |
| Festival Vibe Bubbles | Drop an emoji + caption on a rave | LIVE | Festival Vibe Bubbles |
| Rave Card (Gig Poster) | Shareable poster for one rave | LIVE | Shareable Rave Card |
| Home screen countdown | "Days until" link per crew + personal link | LIVE | HOME SCREEN COUNTDOWN |
| Countdown widget | Home/lock-screen widget | iOS | NATIVE COUNTDOWN WIDGET |

## 7. Lineups — `#lineups`
| Feature | What it is | Tag | app.html section |
|---|---|---|---|
| Lineup Explorer | Free public lineups: filter, search, preview, 📋 pick sets | LIVE | Lineup Explorer links |
| Picks sync | Explorer picks save to your account + RSVPs | LIVE | Lineup Explorer picks handoff |
| Crew picks + crew vote | See overlap; vote → ⭐ Fam Faves | LIVE | (lineup-explorer) |
| Set reminders + On deck | Push 15 min before picked sets; clash flags | LIVE / iOS push | Set reminders |
| Lineup alerts | Fave added, set times posted (push or email) | LIVE | NOTIFICATION DB HELPERS |
| Shared lineup tagging | Crowd-source a rave's lineup | LIVE | Rave lineup tagging |
| Post-fest check-off | "Who'd you catch?" → seen-live counts | LIVE | Post-fest check-off |
| Top 3 sets | Rank your top 3 after a rave | LIVE | Top 3 sets |

## 8. Ravers & profiles — `#ravers`
| Feature | What it is | Tag | app.html section |
|---|---|---|---|
| Profile page | Raves · Vibe · Crews · Us/Notes tabs | LIVE | Profile tabs / openProfile |
| Sound | Genres + favourite artists | LIVE | Genre Presets / Favourite artist picker |
| Vibe Tags | Preset vibe tags on your profile | LIVE | Vibe Tags |
| How We Met | Pairwise "how we met" stories | LIVE | HOW WE MET |
| PLUR Points | Points across Peace/Love/Unity/Respect + milestones | LIVE | PLUR POINTS |
| Discover places | First visit to each tab unlocks it (+10 Unity) | LIVE | REALMS |

## 9. Stats — `#stats`
| Feature | What it is | Tag | app.html section |
|---|---|---|---|
| Stats page | Raves logged, days raved, cities hit, distance; time-range filter | LIVE | STATS PAGE / sub-pages |
| Cities Hit map | Map of everywhere you've raved | LIVE | Stats sub-pages |
| Radar Map | Upcoming raves on a radar-sweep map | LIVE | Radar Map |
| Radar Share Card | "Here's where I'm headed" image | LIVE | Radar Share Card |
| Rave Wrapped | Teased only: "something's hiding in Stats…". Unlock method not revealed | LIVE (teased) | Rave Wrapped |

## 10. Vendor Village — `#vendor-village`
| Feature | What it is | Tag | app.html section |
|---|---|---|---|
| Browse + save vendors | Crew-sourced directory of local vendors | LIVE | VENDOR VILLAGE — Browse / Saved |
| Add + edit vendors | Submit vendors with vibe tags | LIVE | Add / Edit Vendor |
| Reviews | Rate and review vendors | LIVE | Detail view + reviews |
| Crew cosigns | See which crewmates vouch for a vendor | LIVE | Crew cosigns |
| Spotted right now | Live check-ins at a rave | LIVE | Spotted-right-now |
| Vendor badges | Personal badges (Vendor Scout, Marketplace Explorer…) | LIVE | Personal badges |

## 11. Safety, privacy & help — `#privacy`
| Feature | What it is | Tag | app.html section |
|---|---|---|---|
| Privacy controls | Choose what crews/ravers see, incl. crew activity | LIVE | Settings |
| PLUR Code | Community code of conduct | LIVE | MODERATION: PLUR Code |
| Block + report | Block a raver; report content | LIVE | BLOCKING / Report flow |
| Notifications | Per-alert toggles; push on iOS, else email | LIVE / iOS push | NATIVE PUSH |
| Guide & Help | Help levels (Show me around / Hints / Pro) + searchable FAQ | LIVE | GUIDANCE KIT / HELP CENTER |
| Talk to us | In-app bug / idea / help messages | LIVE | CONTACT US |
| Delete account | Immediate, permanent erase | LIVE | DELETE ACCOUNT |
| Android | Android beta waitlist | SOON | ANDROID BETA WAITLIST |

---

## Excluded (internal / staff only)
Mod Dashboard, Mod Guide, PM Metrics Dashboard, micro-feedback & NPS prompts,
iOS App Store nudge, captcha, soft-delete/audit internals, Ko-fi tip jar,
New crew page (BETA toggle).
