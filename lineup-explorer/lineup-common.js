// Best-effort analytics for the internal PM metrics dashboard: a pageview
// ping per festival page load, plus a single delegated click listener that
// catches every "preview on Spotify/Apple/etc" link click across all
// festival pages (artist cards set href via LineupPlatforms.buildUrl at
// *render* time, which fires on every filter/search re-render — hooking
// that would wildly overcount, so this listens for the real click instead).
// supabase-js is loaded lazily here (not referenced anywhere else on these
// static pages), so it never blocks first paint.
(function () {
  "use strict";

  function getVisitorId() {
    try {
      var vid = window.localStorage.getItem("rf_vid");
      if (!vid) { vid = crypto.randomUUID(); window.localStorage.setItem("rf_vid", vid); }
      return vid;
    } catch (e) { return null; }
  }

  function getUtmParams() {
    try {
      var p = new URLSearchParams(location.search);
      return { source: p.get("utm_source"), medium: p.get("utm_medium"), campaign: p.get("utm_campaign") };
    } catch (e) { return {}; }
  }

  var sbClient = null;
  var sbReadyCallbacks = [];
  function withClient(fn) {
    if (sbClient) { fn(sbClient); return; }
    sbReadyCallbacks.push(fn);
  }

  var script = document.createElement("script");
  script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
  script.onload = function () {
    try {
      sbClient = window.supabase.createClient(
        "https://tvpgopciioqbqmjjjigh.supabase.co",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2cGdvcGNpaW9xYnFtampqaWdoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3NTY2OTUsImV4cCI6MjA5NjMzMjY5NX0.DAgcx2UsGV1gUCQzHdGmv1Pu0rXlJdQxhn-bf1wGsiI"
      );
      sbReadyCallbacks.forEach(function (fn) { fn(sbClient); });
      sbReadyCallbacks = [];
    } catch (e) {}
  };
  document.head.appendChild(script);

  window._rfTrack = {
    previewClick: function (platform, query) {
      withClient(function (sb) {
        sb.rpc("log_preview_click", {
          p_path: location.pathname, p_platform: platform, p_query: query, p_visitor_id: getVisitorId()
        }).then(function () {}, function () {});
      });
    }
  };

  withClient(function (sb) {
    var utm = getUtmParams();
    sb.rpc("log_pageview", {
      p_path: location.pathname, p_referrer: document.referrer, p_visitor_id: getVisitorId(),
      p_utm_source: utm.source, p_utm_medium: utm.medium, p_utm_campaign: utm.campaign
    }).then(function () {}, function () {});
  });

  // Member detection for the Lineup Explorer ↔ RaveFAM integration. The
  // explorer shares myravefam.com with /app, so a RaveFAM login's Supabase
  // session is already in this browser's storage — no separate sign-in. This
  // only reads state; nothing on the page changes yet. Resolves to:
  //   { isMember, userId, raverId, festival: { id, slug, name, date } | null }
  // Visitors (no session) resolve right away with isMember: false and make no
  // extra requests. Festival lookup needs auth (festivals RLS), so it's
  // member-only; the page slug equals festivals.slug.
  function pageSlug() {
    var m = /^\/lineup-explorer\/([a-z0-9-]+?)(?:\.html)?\/?$/.exec(location.pathname);
    return m && m[1] !== "index" ? m[1] : null;
  }

  var memberPromise = new Promise(function (resolve) {
    var visitor = { isMember: false, userId: null, raverId: null, festival: null };
    // supabase-js is loaded from a CDN; if it never arrives, treat as visitor.
    setTimeout(function () { resolve(visitor); }, 8000);
    withClient(function (sb) {
      sb.auth.getSession().then(function (res) {
        var session = res && res.data && res.data.session;
        if (!session || !session.user) { resolve(visitor); return; }
        var uid = session.user.id;
        var slug = pageSlug();
        Promise.all([
          sb.from("ravers").select("id,is_you,status").eq("claimed_by", uid).neq("status", "merged"),
          slug
            ? sb.from("festivals").select("id,slug,name,date").eq("slug", slug).is("deleted_at", null).maybeSingle()
            : Promise.resolve({ data: null })
        ]).then(function (out) {
          var rows = (out[0] && out[0].data) || [];
          var you = rows.filter(function (r) { return r.is_you || r.status === "claimed"; })[0] || null;
          resolve({
            isMember: true,
            userId: uid,
            raverId: you ? you.id : null,
            festival: (out[1] && out[1].data) || null
          });
        }, function () {
          resolve({ isMember: true, userId: uid, raverId: null, festival: null });
        });
      }, function () { resolve(visitor); });
    });
  });

  window.LineupMember = {
    ready: function (fn) { return memberPromise.then(fn); },
    pageSlug: pageSlug,
    client: withClient,
    visitorId: getVisitorId
  };

  // First explorer page this browser ever opened. app.html reads it when a
  // brand-new account boots, to tag signup_completed with source "explorer".
  try {
    if (!window.localStorage.getItem("rf_first_explorer")) {
      window.localStorage.setItem("rf_first_explorer", JSON.stringify({
        slug: pageSlug() || "hub", at: new Date().toISOString()
      }));
    }
  } catch (e) {}

  // Best-effort client error logging for the PM dashboard's "Client Errors"
  // section — deduped per page load so one repeating bug doesn't spam rows.
  var _seenErrors = {};
  function logClientError(message, stack) {
    var key = String(message).slice(0, 200);
    if (_seenErrors[key]) return;
    _seenErrors[key] = true;
    withClient(function (sb) {
      sb.rpc("log_client_error", {
        p_message: message, p_stack: stack || null, p_path: location.pathname,
        p_visitor_id: getVisitorId(), p_user_agent: navigator.userAgent
      }).then(function () {}, function () {});
    });
  }
  window.addEventListener("error", function (e) {
    logClientError(e.message, e.error && e.error.stack);
  });
  window.addEventListener("unhandledrejection", function (e) {
    var reason = e.reason;
    logClientError(reason && reason.message ? reason.message : String(reason), reason && reason.stack);
  });

  var PLATFORM_HREF_PATTERNS = [
    [/open\.spotify\.com/, "spotify"],
    [/music\.youtube\.com/, "youtube"],
    [/music\.apple\.com/, "apple"],
    [/soundcloud\.com/, "soundcloud"],
    [/beatport\.com/, "beatport"]
  ];

  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var href = a.href || "";
    var match = PLATFORM_HREF_PATTERNS.find(function (p) { return p[0].test(href); });
    if (!match) return;
    var label = (a.getAttribute("aria-label") || a.textContent || "").trim().slice(0, 200);
    window._rfTrack.previewClick(match[1], label);
  }, true);
})();

(function () {
  "use strict";

  var STORAGE_KEY = "rf_lineup_platform";

  var PLATFORMS = [
    {
      id: "spotify",
      label: "Spotify",
      color: "#1DB954",
      searchUrl: function (q) { return "https://open.spotify.com/search/" + encodeURIComponent(q); },
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9.3" stroke-width="1.5"/><path d="M6.8 9.7c3.4-1 7.7-.6 10.5 1"/><path d="M7.3 12.8c2.9-.8 6.4-.5 8.9.8"/><path d="M7.9 15.7c2.3-.6 5-.4 6.9.6"/></svg>'
    },
    {
      id: "youtube",
      label: "YouTube Music",
      color: "#FF0000",
      searchUrl: function (q) { return "https://music.youtube.com/search?q=" + encodeURIComponent(q); },
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9.3"/><path d="M10 8.6l6 3.4-6 3.4z" fill="currentColor" stroke="none"/></svg>'
    },
    {
      id: "apple",
      label: "Apple Music",
      color: "#FC3C44",
      // The Apple Music iOS app registers music.apple.com/search as a Universal
      // Link but doesn't parse the query and show results — it just opens to a
      // blank search tab. Routing through a Google site-search sidesteps that
      // app hijack (google.com isn't a Universal Link domain for the app), and
      // the actual result the user taps is a real artist page, which the app
      // *does* deep-link correctly.
      searchUrl: function (q) { return "https://www.google.com/search?q=" + encodeURIComponent("site:music.apple.com " + q); },
      icon: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.2 4.2v10.3a3.35 3.35 0 1 1-1.6-2.85V8.2L9.7 9.5v7.15a3.35 3.35 0 1 1-1.6-2.86V6.4l8.1-2.2z"/></svg>'
    },
    {
      id: "soundcloud",
      label: "SoundCloud",
      color: "#FF7700",
      // Same Universal Link hijack issue as Apple Music above — the SoundCloud
      // iOS app intercepts soundcloud.com/search but doesn't run the query.
      searchUrl: function (q) { return "https://www.google.com/search?q=" + encodeURIComponent("site:soundcloud.com " + q); },
      icon: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7.3 17a3.6 3.6 0 0 1-.42-7.18 4.6 4.6 0 0 1 8.8-1.94A3.85 3.85 0 0 1 17.6 17H7.3z"/></svg>'
    },
    {
      id: "beatport",
      label: "Beatport",
      color: "#01FF95",
      searchUrl: function (q) { return "https://www.beatport.com/search?q=" + encodeURIComponent(q); },
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4v16"/><path d="M6 5h7a3.5 3.5 0 0 1 0 7H6"/><path d="M6 12h8a3.5 3.5 0 0 1 0 7H6"/></svg>'
    }
  ];

  function getActive() {
    var stored;
    try { stored = window.localStorage.getItem(STORAGE_KEY); } catch (e) { stored = null; }
    var valid = PLATFORMS.some(function (p) { return p.id === stored; });
    return valid ? stored : PLATFORMS[0].id;
  }

  function getPlatform(id) {
    var target = id || getActive();
    for (var i = 0; i < PLATFORMS.length; i++) {
      if (PLATFORMS[i].id === target) return PLATFORMS[i];
    }
    return PLATFORMS[0];
  }

  function setActive(id) {
    if (!PLATFORMS.some(function (p) { return p.id === id; })) return;
    try { window.localStorage.setItem(STORAGE_KEY, id); } catch (e) {}
    window.dispatchEvent(new CustomEvent("lineupplatformchange", { detail: { id: id } }));
  }

  function buildUrl(query) {
    return getPlatform().searchUrl(query);
  }

  function renderToggle(container, onChange) {
    if (!container) return;
    container.innerHTML = "";

    function paint() {
      var active = getActive();
      container.querySelectorAll(".platform-btn").forEach(function (btn) {
        btn.setAttribute("aria-pressed", btn.dataset.platform === active);
      });
    }

    PLATFORMS.forEach(function (p) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "platform-btn";
      btn.dataset.platform = p.id;
      btn.style.setProperty("--pc", p.color);
      btn.title = p.label;
      btn.setAttribute("aria-label", "Switch to " + p.label);
      btn.setAttribute("aria-pressed", String(p.id === getActive()));
      btn.innerHTML = p.icon;
      btn.addEventListener("click", function () {
        setActive(p.id);
        paint();
        if (typeof onChange === "function") onChange(p.id);
      });
      container.appendChild(btn);
    });

    window.addEventListener("storage", function (e) {
      if (e.key === STORAGE_KEY) {
        paint();
        if (typeof onChange === "function") onChange(getActive());
      }
    });
  }

  window.LineupPlatforms = {
    PLATFORMS: PLATFORMS,
    STORAGE_KEY: STORAGE_KEY,
    getActive: getActive,
    setActive: setActive,
    getPlatform: getPlatform,
    buildUrl: buildUrl,
    renderToggle: renderToggle
  };
})();

// Home-screen icon: a Lineup-Explorer-specific mark (distinct from the main
// RaveFAM app icon), applied via apple-touch-icon (iOS) and a per-page
// manifest (Android). The manifest is built per page rather than shared as a
// static file so each installed shortcut's start_url points back at the
// specific event page it was added from, not the /lineup-explorer/ hub.
(function () {
  "use strict";

  var appleTouchIcon = document.querySelector('link[rel="apple-touch-icon"]');
  if (!appleTouchIcon) {
    appleTouchIcon = document.createElement("link");
    appleTouchIcon.rel = "apple-touch-icon";
    document.head.appendChild(appleTouchIcon);
  }
  appleTouchIcon.href = "/lineup-explorer/apple-touch-icon.png";

  var title = (document.title.split(" — ")[0] || "RaveFAM").replace(/ Lineup$/, "").trim();
  var manifest = {
    name: title,
    short_name: title,
    start_url: window.location.pathname,
    scope: "/lineup-explorer/",
    display: "standalone",
    background_color: "#07050f",
    theme_color: "#07050f",
    icons: [
      { src: "/lineup-explorer/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/lineup-explorer/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable any" }
    ]
  };
  var blob = new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" });
  var manifestLink = document.createElement("link");
  manifestLink.rel = "manifest";
  manifestLink.href = URL.createObjectURL(blob);
  document.head.appendChild(manifestLink);
})();

(function () {
  "use strict";

  function isStandalone() {
    if (window.navigator.standalone === true) return true;
    try { return window.matchMedia("(display-mode: standalone)").matches; } catch (e) { return false; }
  }

  function detectOS() {
    var ua = window.navigator.userAgent || "";
    var isIOS = /iPhone|iPad|iPod/.test(ua) ||
      (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
    if (isIOS) return "ios";
    if (/Android/.test(ua)) return "android";
    return "other";
  }

  function stepsFor(os) {
    if (os === "ios") {
      return {
        title: "Save to Home Screen",
        sub: "Add this page as an icon on your iPhone or iPad — opens instantly, just like an app.",
        steps: [
          "Tap the <b>Share</b> icon (the square with an arrow) in Safari's toolbar.",
          "Scroll down and tap <b>Add to Home Screen</b>.",
          "Tap <b>Add</b> in the top right corner."
        ],
        note: "Opening this from Instagram, TikTok, or another app? Tap the <b>•••</b> menu first and choose <b>Open in Safari</b> — the Share option only shows up there."
      };
    }
    if (os === "android") {
      return {
        title: "Save to Home Screen",
        sub: "Add this page as an icon on your Android phone — opens instantly, just like an app.",
        steps: [
          "Tap the <b>⋮</b> menu in the top right of Chrome.",
          "Tap <b>Add to Home screen</b> (or <b>Install app</b>).",
          "Tap <b>Add</b> to confirm."
        ]
      };
    }
    return {
      title: "Save to Home Screen",
      sub: "Open this page on your phone to save it to your home screen — works on both iPhone and Android.",
      steps: []
    };
  }

  function buildModal(os) {
    var content = stepsFor(os);
    var overlay = document.createElement("div");
    overlay.className = "a2hs-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "a2hsTitle");

    var stepsHtml = content.steps.length
      ? '<ol class="a2hs-steps">' + content.steps.map(function (s) { return "<li>" + s + "</li>"; }).join("") + "</ol>"
      : "";
    var noteHtml = content.note ? '<p class="a2hs-note">' + content.note + "</p>" : "";

    overlay.innerHTML =
      '<div class="a2hs-modal">' +
        '<button type="button" class="a2hs-close" aria-label="Close">✕</button>' +
        '<h3 id="a2hsTitle">' + content.title + "</h3>" +
        '<p class="a2hs-sub">' + content.sub + "</p>" +
        stepsHtml + noteHtml +
      "</div>";

    function close() {
      overlay.classList.remove("show");
      setTimeout(function () { overlay.remove(); }, 200);
    }

    overlay.querySelector(".a2hs-close").addEventListener("click", close);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.addEventListener("keydown", function onKey(e) {
      if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); }
    });

    document.body.appendChild(overlay);
    void overlay.offsetHeight; // force reflow so the transition below actually animates
    overlay.classList.add("show");
  }

  function injectButton() {
    if (isStandalone()) return;
    var bar = document.querySelector(".brandbar");
    if (!bar) return;

    var os = detectOS();
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "a2hs-btn";
    btn.innerHTML = "📲 Save";
    btn.setAttribute("aria-label", "Save this page to your home screen");
    btn.addEventListener("click", function () { buildModal(os); });

    var yr = bar.querySelector(".yr");
    if (yr) {
      var wrap = document.createElement("span");
      wrap.className = "a2hs-yr-wrap";
      yr.parentNode.insertBefore(wrap, yr);
      wrap.appendChild(btn);
      wrap.appendChild(yr);
    } else {
      bar.appendChild(btn);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectButton);
  } else {
    injectButton();
  }
})();

// ☆ picks (Lineup Explorer ↔ RaveFAM integration, Phase 1a).
// Visitors: picks live in this browser (localStorage "rf_picks", keyed by
// page slug) until they sign up; /app imports them after login. Members:
// picks are raver_artist_plans rows, which need a Going or Interested RSVP
// for the festival, so a member's first ☆ on a rave they haven't RSVP'd
// opens a one-question sheet and holds picks in the browser meanwhile.
// Writes match app.html's (upsert ignoreDuplicates; Going and Interested are
// mutually exclusive). Each festival page hooks in with three identical
// lines: card() returns LineupPicks.wrap(el, a), visible() ANDs
// LineupPicks.ok(a), and LineupPicks.init(ACTS, render) runs before the first
// render(). b2b acts ("A b2b B") map to one plan per artist, as in the seed.
(function () {
  "use strict";

  // 📋 pick toggle: outline clipboard (off) / filled clipboard with a ✓ (on).
  var CLIP_OFF = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<rect x="5" y="4.5" width="14" height="16.5" rx="2.5"/><path d="M9 4.5v-.7A1.3 1.3 0 0 1 10.3 2.5h3.4A1.3 1.3 0 0 1 15 3.8v.7"/>' +
    '<path d="M8.5 10h7M8.5 13.5h7M8.5 17h4"/></svg>';
  var CLIP_ON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<rect x="5" y="4.5" width="14" height="16.5" rx="2.5" fill="currentColor"/><path d="M9 4.5v-.7A1.3 1.3 0 0 1 10.3 2.5h3.4A1.3 1.3 0 0 1 15 3.8v.7"/>' +
    '<path d="M8.6 13.2l2.4 2.4 4.4-4.8" stroke="#0a0512" stroke-width="2.2"/></svg>';

  var STORE = "rf_picks";
  var TIP_KEY = "rf_picks_tip";
  var FROM_KEY = "rf_picks_from";
  var noop = function () {};

  function readAll() {
    try {
      var v = JSON.parse(window.localStorage.getItem(STORE) || "{}");
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch (e) { return {}; }
  }
  function writeAll(all) { try { window.localStorage.setItem(STORE, JSON.stringify(all)); } catch (e) {} }

  function eventMeta() {
    var nodes = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < nodes.length; i++) {
      try {
        var j = JSON.parse(nodes[i].textContent);
        if (j && /Event$|Festival$/.test(j["@type"] || "")) return { t: j.name || null, d: j.startDate || null };
      } catch (e) {}
    }
    return { t: null, d: null };
  }

  function splitKeys(name) {
    return String(name).split(/\s+b2b\s+/i).map(function (s) { return s.trim().toLowerCase(); });
  }

  var slug = null, acts = [], onRender = null;
  var view = "all";        // "all" | "picks" | "favs" | "crew" | "shared" (favs, crew: members only)
  var sortWanted = false;  // "🔥 Most wanted" sort (members only)
  var local = [];          // act names picked in this browser for this page
  var member = null;       // LineupMember result, once it resolves as a member
  var rsvp = null;         // "going" | "interested" | null (members only)
  var idsByKey = {};       // artists.name_lower -> artists.id
  var plans = {};          // artists.id -> true: this member's plans here
  var favs = {};           // artists.id -> true: this member's ♡ favorites
  var wantByKey = {};      // name_lower -> { want, gain_7d } (public, 5+ only)
  var wantMax = 0;
  var wantTop = [];        // [{ key, want, gain_7d }] in the server's most-wanted order
  var crew = null;         // get_lineup_crew_pulse() result (members)
  var barEl = null, saveEl = null;

  var memberLoaded = false; // plans + RSVP fetched for this festival
  function isMemberMode() { return !!(memberLoaded && member && member.raverId && member.festival); }

  function saveLocal() {
    if (!slug) return;
    var all = readAll();
    if (local.length) {
      var m = eventMeta();
      all[slug] = { n: local.slice(), t: m.t, d: m.d, at: new Date().toISOString() };
    } else {
      delete all[slug];
    }
    writeAll(all);
  }

  function actIds(a) {
    var ids = splitKeys(a.name).map(function (k) { return idsByKey[k]; });
    return ids.every(Boolean) ? ids : null;
  }

  function isPicked(a) {
    if (local.indexOf(a.name) !== -1) return true;
    if (!isMemberMode()) return false;
    var ids = actIds(a);
    return !!ids && ids.every(function (id) { return plans[id]; });
  }

  function pickedActs() { return acts.filter(isPicked); }

  // ----- ♡ favorites + Pulse (Phase 1b) -----
  function isFav(a) {
    if (!isMemberMode()) return false;
    var ids = actIds(a);
    return !!ids && ids.every(function (id) { return favs[id]; });
  }

  // Public "want to see" count for an act (5+ only, from get_lineup_want_counts);
  // a b2b act shows its better-known half.
  function actWant(a) {
    var best = null;
    splitKeys(a.name).forEach(function (k) {
      var w = wantByKey[k];
      if (w && (!best || w.want > best.want)) best = w;
    });
    return best;
  }

  // ----- crew layer (Phase 2a; data from get_lineup_crew_pulse) -----
  var crewSel = "all";     // crew switcher: "all" or a crew id

  function mateOk(id) {
    var m = crew && crew.mates && crew.mates[id];
    if (!m) return false;
    return crewSel === "all" || (Array.isArray(m.c) && m.c.indexOf(crewSel) !== -1);
  }

  // Visible crewmates here (Going first), for the panel and header line.
  function crewHere() {
    if (!crew || !crew.mates) return [];
    return Object.keys(crew.mates).filter(mateOk).map(function (id) {
      var m = crew.mates[id]; m.id = id; return m;
    }).sort(function (x, y) {
      return (x.s === y.s ? 0 : x.s === "going" ? -1 : 1) || (x.u === y.u ? 0 : x.u ? 1 : -1) ||
        String(x.n).localeCompare(String(y.n));
    });
  }

  // Claimed crewmates (current switcher) who picked any artist in the act.
  function actCrew(a) {
    if (!crew || !crew.picks) return [];
    var seen = {}, out = [];
    (actIds(a) || []).forEach(function (id) {
      (crew.picks[id] || []).forEach(function (rid) {
        if (seen[rid] || !mateOk(rid)) return;
        seen[rid] = true;
        var m = crew.mates[rid]; m.id = rid;
        out.push(m);
      });
    });
    return out;
  }

  function faceEl(m, tag) {
    var f = document.createElement(tag || "span");
    f.className = "lp-face" + (m.s === "going" ? " is-going" : " is-interested") + (m.u ? " is-unclaimed" : "");
    if (m.a && /^https:\/\//.test(m.a)) {
      var img = document.createElement("img");
      img.src = m.a; img.alt = ""; img.loading = "lazy";
      f.appendChild(img);
    } else {
      f.appendChild(document.createTextNode((m.n || "?").charAt(0).toUpperCase()));
      if (m.g && /^linear-gradient\([#0-9a-zA-Z,.%() ]+\)$/.test(m.g)) f.style.background = m.g;
    }
    return f;
  }

  function statusWord(m) { return m.s === "going" ? "Going" : "Interested"; }

  function pulseEl(a) {
    var w = actWant(a);
    if (!w) return null;
    var row = document.createElement("div");
    row.className = "lp-pulse";
    if (isMemberMode()) {
      var heat = document.createElement("span");
      heat.className = "lp-heat";
      heat.setAttribute("aria-hidden", "true");
      var fill = document.createElement("i");
      fill.style.width = Math.max(8, Math.round(100 * w.want / (wantMax || w.want))) + "%";
      heat.appendChild(fill);
      row.appendChild(heat);
    }
    var t = document.createElement("span");
    t.className = "lp-want";
    t.textContent = w.want + " want to see" + (w.gain_7d ? " · +" + w.gain_7d + " this week" : "");
    row.appendChild(t);
    return row;
  }

  // "👥 2 crew" tray under a card; expands in place to names and statuses.
  // Lives outside the card's <a> so it can be a real button.
  function crewTrayEl(a) {
    var mates = isMemberMode() ? actCrew(a) : [];
    if (!mates.length) return null;
    var tray = document.createElement("div");
    tray.className = "lp-tray";
    var b = document.createElement("button");
    b.type = "button";
    b.className = "lp-tray-btn";
    b.setAttribute("aria-expanded", "false");
    var faces = document.createElement("span");
    faces.className = "lp-faces";
    faces.setAttribute("aria-hidden", "true");
    mates.slice(0, 3).forEach(function (m) { faces.appendChild(faceEl(m)); });
    b.appendChild(faces);
    var names = mates.map(function (m) { return m.n || "Crewmate"; });
    b.appendChild(document.createTextNode(mates.length + " crew · " + names.slice(0, 2).join(", ") + (names.length > 2 ? " +" + (names.length - 2) : "")));
    b.setAttribute("aria-label", names.join(", ") + " from your crew picked " + a.name);
    var list = document.createElement("ul");
    list.className = "lp-tray-list";
    list.hidden = true;
    mates.forEach(function (m) {
      var li = document.createElement("li");
      li.appendChild(faceEl(m));
      li.appendChild(document.createTextNode((m.n || "Crewmate") + " · " + statusWord(m)));
      list.appendChild(li);
    });
    b.addEventListener("click", function (e) {
      e.preventDefault();
      var open = list.hidden;
      list.hidden = !open;
      b.setAttribute("aria-expanded", String(open));
    });
    tray.appendChild(b);
    tray.appendChild(list);
    return tray;
  }

  // "Your crew here" panel above the picks bar.
  var crewEl = null;
  function renderCrewPanel() {
    if (!barEl) return;
    var mates = isMemberMode() ? crewHere() : [];
    if (!crewEl) {
      crewEl = document.createElement("section");
      crewEl.className = "lp-crew";
      crewEl.setAttribute("aria-labelledby", "lpCrewTitle");
      barEl.parentNode.insertBefore(crewEl, barEl);
    }
    var crews = (crew && crew.crews) || [];
    if (!isMemberMode() || (!mates.length && crewSel === "all")) { crewEl.hidden = true; return; }
    crewEl.hidden = false;
    crewEl.innerHTML = "";
    var top = document.createElement("div");
    top.className = "lp-crew-top";
    var h = document.createElement("h2");
    h.id = "lpCrewTitle";
    h.textContent = "Your crew here";
    top.appendChild(h);
    var going = mates.filter(function (m) { return m.s === "going"; }).length;
    var interested = mates.length - going;
    var sum = document.createElement("span");
    sum.className = "lp-crew-sum";
    sum.textContent = [going ? going + " going" : "", interested ? interested + " interested" : ""].filter(Boolean).join(" · ") || "No one from this crew yet";
    top.appendChild(sum);
    crewEl.appendChild(top);

    if (crews.length > 1) {
      var sw = document.createElement("div");
      sw.className = "lp-crew-switch";
      sw.setAttribute("role", "group");
      sw.setAttribute("aria-label", "Show one crew");
      [{ id: "all", n: "All crews" }].concat(crews).forEach(function (c) {
        var cb = document.createElement("button");
        cb.type = "button";
        cb.className = "lp-crew-chip";
        cb.textContent = c.n;
        cb.setAttribute("aria-pressed", String(crewSel === c.id));
        if (c.col && /^#[0-9a-fA-F]{3,8}$/.test(c.col)) cb.style.setProperty("--cc", c.col);
        cb.addEventListener("click", function () { crewSel = c.id; refresh(); });
        sw.appendChild(cb);
      });
      crewEl.appendChild(sw);
    }

    var row = document.createElement("div");
    row.className = "lp-crew-faces";
    mates.forEach(function (m) {
      var wrap = document.createElement("span");
      wrap.className = "lp-crew-mate";
      if (m.u) {
        var fb = faceEl(m, "button");
        fb.type = "button";
        fb.setAttribute("aria-label", (m.n || "Crewmate") + ", " + statusWord(m) + ", not on RaveFAM yet");
        fb.setAttribute("aria-expanded", "false");
        var pop = document.createElement("span");
        pop.className = "lp-crew-pop";
        pop.hidden = true;
        pop.appendChild(document.createTextNode((m.n || "They") + " isn't on RaveFAM yet. "));
        if (m.inv) {
          var link = document.createElement("a");
          link.href = "/app?invite=" + encodeURIComponent(m.id);
          link.textContent = "Send claim link";
          pop.appendChild(link);
        } else {
          pop.appendChild(document.createTextNode("Your crew leader can send them a claim link."));
        }
        fb.addEventListener("click", function () {
          var open = pop.hidden;
          pop.hidden = !open;
          fb.setAttribute("aria-expanded", String(open));
        });
        wrap.appendChild(fb);
        wrap.appendChild(pop);
      } else {
        var f = faceEl(m);
        f.setAttribute("role", "img");
        f.setAttribute("aria-label", (m.n || "Crewmate") + ", " + statusWord(m));
        f.title = (m.n || "Crewmate") + " · " + statusWord(m);
        wrap.appendChild(f);
      }
      var nm = document.createElement("span");
      nm.className = "lp-crew-name";
      nm.setAttribute("aria-hidden", "true");
      nm.textContent = m.n || "Crewmate";
      wrap.appendChild(nm);
      row.appendChild(wrap);
    });
    crewEl.appendChild(row);

    var overlap = pickedActs().filter(function (a) { return actCrew(a).length; });
    if (overlap.length) {
      var ov = document.createElement("p");
      ov.className = "lp-crew-overlap";
      var names = overlap.map(function (a) { return a.name; });
      ov.textContent = "📋 You and your crew both picked: " + names.slice(0, 6).join(", ") + (names.length > 6 ? " +" + (names.length - 6) : "");
      crewEl.appendChild(ov);
    }
  }

  // ----- Most wanted here (Phase 3a; counts from get_lineup_want_counts) -----
  // Top 5 acts on this page by members' 📋 picks. The server already drops
  // anything under 5, so an empty list simply hides the panel.
  var mwEl = null;
  var focusSel = null;     // refresh() focus target while a panel button drives toggle()
  function mostWantedActs() {
    var byKey = {};
    acts.forEach(function (a) { splitKeys(a.name).forEach(function (k) { if (!byKey[k]) byKey[k] = a; }); });
    var seen = {}, out = [];
    wantTop.forEach(function (w) {
      var a = byKey[w.key];
      if (!a || seen[a.name] || out.length >= 5) return;
      seen[a.name] = true;
      out.push({ act: a, want: w.want, gain_7d: w.gain_7d });
    });
    return out;
  }

  function jumpToAct(a) {
    function find() {
      var btns = document.querySelectorAll(".pick");
      for (var i = 0; i < btns.length; i++) if (btns[i].dataset.n === a.name) return btns[i];
      return null;
    }
    var b = find();
    if (!b && view !== "all") { view = "all"; refresh(); b = find(); }
    if (!b) return;
    var box = b.closest(".act-cell") || b.closest(".act-wrap") || b;
    box.scrollIntoView({ behavior: "smooth", block: "center" });
    box.classList.remove("lp-flash");
    void box.offsetWidth;
    box.classList.add("lp-flash");
    setTimeout(function () { box.classList.remove("lp-flash"); }, 1600);
  }

  function renderMostWanted() {
    if (!barEl) return;
    var top = mostWantedActs();
    if (!mwEl) {
      mwEl = document.createElement("section");
      mwEl.className = "lp-mw";
      mwEl.setAttribute("aria-labelledby", "lpMwTitle");
      barEl.parentNode.insertBefore(mwEl, barEl);
    }
    if (!top.length) { mwEl.hidden = true; return; }
    mwEl.hidden = false;
    mwEl.innerHTML = "";
    var memberMode = isMemberMode();
    var h = document.createElement("h2");
    h.id = "lpMwTitle";
    h.textContent = "🔥 Most wanted here";
    mwEl.appendChild(h);
    var max = top[0].want || 1;
    var ol = document.createElement("ol");
    ol.className = "lp-mw-list";
    top.forEach(function (x, i) {
      var a = x.act;
      var li = document.createElement("li");
      li.className = "lp-mw-row";
      var rank = document.createElement("span");
      rank.className = "lp-mw-rank";
      rank.setAttribute("aria-hidden", "true");
      rank.textContent = String(i + 1);
      li.appendChild(rank);
      var main = document.createElement("div");
      main.className = "lp-mw-main";
      var nb = document.createElement("button");
      nb.type = "button";
      nb.className = "lp-mw-name";
      nb.textContent = a.name;
      nb.setAttribute("aria-label", a.name + ", " + x.want + " want to see. Show on the lineup");
      nb.addEventListener("click", function () { jumpToAct(a); });
      main.appendChild(nb);
      var meta = document.createElement("div");
      meta.className = "lp-mw-meta";
      var heat = document.createElement("span");
      heat.className = "lp-heat";
      heat.setAttribute("aria-hidden", "true");
      var fill = document.createElement("i");
      fill.style.width = Math.max(8, Math.round(100 * x.want / max)) + "%";
      heat.appendChild(fill);
      meta.appendChild(heat);
      var c = document.createElement("span");
      c.className = "lp-want";
      c.textContent = x.want + " want to see";
      meta.appendChild(c);
      if (x.gain_7d) {
        var g = document.createElement("span");
        g.className = "lp-mw-gain";
        g.textContent = "+" + x.gain_7d + " this week";
        meta.appendChild(g);
      }
      main.appendChild(meta);
      li.appendChild(main);
      if (memberMode) {
        var mates = actCrew(a);
        if (mates.length) {
          var faces = document.createElement("span");
          faces.className = "lp-faces";
          faces.setAttribute("role", "img");
          faces.setAttribute("aria-label", mates.length + (mates.length === 1 ? " crewmate picked this" : " crewmates picked this"));
          mates.slice(0, 3).forEach(function (m) { faces.appendChild(faceEl(m)); });
          if (mates.length > 3) {
            var more = document.createElement("span");
            more.className = "lp-face lp-more";
            more.textContent = "+" + (mates.length - 3);
            faces.appendChild(more);
          }
          li.appendChild(faces);
        }
      }
      var picked = isPicked(a);
      var pb = document.createElement("button");
      pb.type = "button";
      pb.className = "lp-mw-pick";
      pb.dataset.n = a.name;
      pb.setAttribute("aria-pressed", String(picked));
      pb.setAttribute("aria-label", picked ? "Remove " + a.name + " from my picks" : "Add " + a.name + " to my picks");
      pb.innerHTML = picked ? CLIP_ON : CLIP_OFF;
      pb.addEventListener("click", function () {
        focusSel = ".lp-mw-pick";
        try { toggle(a); } finally { focusSel = null; }
      });
      li.appendChild(pb);
      ol.appendChild(li);
    });
    mwEl.appendChild(ol);
    if (!member) {
      var foot = document.createElement("div");
      foot.className = "lp-mw-join";
      var t = document.createElement("span");
      t.textContent = "Make your picks count. Only RaveFAM members' picks are counted here.";
      foot.appendChild(t);
      var jb = document.createElement("button");
      jb.type = "button";
      jb.textContent = "Join free";
      jb.addEventListener("click", function () {
        if (local.length) goSave();
        else location.href = "/app";
      });
      foot.appendChild(jb);
      mwEl.appendChild(foot);
    }
  }

  function toggleFav(a) {
    var ids = actIds(a);
    if (!ids) { toast("This artist can't be favorited yet."); return; }
    var on = !isFav(a);
    ids.forEach(function (id) { if (on) favs[id] = true; else delete favs[id]; });
    refresh(a, ".fav");
    window.LineupMember.client(function (sb) {
      var q = on
        ? sb.from("raver_favorite_artists").upsert(ids.map(function (id) {
            return { raver_id: member.raverId, artist_id: id };
          }), { onConflict: "raver_id,artist_id", ignoreDuplicates: true })
        : sb.from("raver_favorite_artists").delete().eq("raver_id", member.raverId).in("artist_id", ids);
      q.then(function (res) {
        if (!res.error) {
          if (on) toast("♡ " + a.name + " added to your favorites. We'll show you where they play next.");
          return;
        }
        ids.forEach(function (id) { if (on) delete favs[id]; else favs[id] = true; });
        toast("⚠️ Couldn't update your favorites. Try again.");
        refresh();
      }, noop);
    });
  }

  // "🔥 Most wanted": reorders the rendered deck by public want count, then
  // crew picks. The page's render() rebuilds the deck on every filter change,
  // so this re-sorts after each rebuild.
  var deckObserver = null;
  function sortDeck() {
    var deck = document.getElementById("deck");
    if (!deck || !sortWanted) return;
    var byName = {};
    acts.forEach(function (a) { byName[a.name] = a; });
    var cards = Array.prototype.slice.call(deck.children);
    var scored = cards.map(function (c, i) {
      var btn = c.querySelector && c.querySelector(".pick");
      var a = btn && byName[btn.dataset.n];
      var w = a ? actWant(a) : null;
      return { c: c, i: i, s: (w ? w.want * 1000 : 0) + (a ? actCrew(a).length : 0) };
    });
    scored.sort(function (x, y) { return y.s - x.s || x.i - y.i; });
    if (deckObserver) deckObserver.disconnect();
    scored.forEach(function (x) { deck.appendChild(x.c); });
    if (deckObserver) deckObserver.observe(deck, { childList: true });
  }
  function watchDeck() {
    var deck = document.getElementById("deck");
    if (!deck || deckObserver || !window.MutationObserver) return;
    deckObserver = new MutationObserver(function () { if (sortWanted) sortDeck(); });
    deckObserver.observe(deck, { childList: true });
  }

  function logEvent(name, props) {
    window.LineupMember.client(function (sb) {
      sb.rpc("log_analytics_event", {
        p_event_name: name,
        p_raver_id: member && member.raverId ? member.raverId : null,
        p_visitor_id: window.LineupMember.visitorId(),
        p_properties: props || {}
      }).then(noop, noop);
    });
  }

  // ----- toast -----
  var toastEl = null, toastTimer = null;
  function toast(msg, actionLabel, action) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "lp-toast";
      toastEl.setAttribute("role", "status");
      toastEl.setAttribute("aria-live", "polite");
      document.body.appendChild(toastEl);
    }
    toastEl.innerHTML = "";
    var t = document.createElement("span");
    t.textContent = msg;
    toastEl.appendChild(t);
    if (actionLabel && action) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = actionLabel;
      b.addEventListener("click", function () { hideToast(); action(); });
      toastEl.appendChild(b);
    }
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, actionLabel ? 6000 : 3500);
  }
  function hideToast() { if (toastEl) toastEl.classList.remove("show"); }

  // ----- save handoff (visitors) -----
  function goSave(fromSlug, n) {
    var from = typeof fromSlug === "string" ? fromSlug : slug;
    logEvent("explorer_save_click", { slug: from, picks: typeof n === "number" ? n : local.length, page: slug || "hub" });
    try {
      window.localStorage.setItem(FROM_KEY, JSON.stringify({ slug: from, back: location.pathname + location.search }));
    } catch (e) {}
    location.href = "/app?picks=1" + (from ? "&from=" + encodeURIComponent(from) : "");
  }

  // ----- hub (/lineup-explorer/): Your picks box + ☆ row on picked cards -----
  function initHub() {
    var cards = document.querySelectorAll(".event-card[href^='/lineup-explorer/']");
    if (!cards.length) return;
    var all = readAll();
    var today = new Date().toISOString().slice(0, 10);
    var rows = [];
    Array.prototype.forEach.call(cards, function (c) {
      var s = c.getAttribute("href").replace("/lineup-explorer/", "").replace(/\.html$/, "");
      var p = all[s];
      var names = p && Array.isArray(p.n) ? p.n.filter(function (x) { return typeof x === "string"; }) : [];
      if (!names.length) return;
      var row = document.createElement("div");
      row.className = "event-picks";
      row.textContent = "📋 " + names.length + (names.length === 1 ? " pick: " : " picks: ") +
        names.slice(0, 3).join(", ") + (names.length > 3 ? ", …" : "");
      var foot = c.querySelector(".event-footer");
      c.insertBefore(row, foot || null);
      var nameEl = c.querySelector(".event-name");
      rows.push({
        slug: s, names: names, at: p.at || "", href: c.getAttribute("href"),
        title: p.t || (nameEl ? nameEl.textContent.replace(/\s+/g, " ").trim() : s),
        past: c.dataset.date ? c.dataset.date < today : false
      });
    });
    if (!rows.length) return;
    var upcoming = rows.filter(function (r) { return !r.past; });
    var total = upcoming.reduce(function (n, r) { return n + r.names.length; }, 0);
    var latest = upcoming.slice().sort(function (a, b) { return a.at < b.at ? 1 : -1; })[0];

    var box = document.createElement("section");
    box.className = "lp-hub";
    box.setAttribute("aria-labelledby", "lpHubTitle");
    var h = document.createElement("h2");
    h.id = "lpHubTitle";
    h.textContent = "📋 Your picks";
    box.appendChild(h);
    var list = document.createElement("ul");
    rows.forEach(function (r) {
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = r.href;
      a.textContent = r.title;
      li.appendChild(a);
      var span = document.createElement("span");
      span.textContent = " · " + r.names.slice(0, 4).join(", ") + (r.names.length > 4 ? " +" + (r.names.length - 4) : "");
      li.appendChild(span);
      list.appendChild(li);
    });
    box.appendChild(list);
    var foot = document.createElement("div");
    foot.className = "lp-save";
    var msg = document.createElement("span");
    msg.className = "lp-save-msg";
    msg.textContent = "Your picks only live on this device. Save them to RaveFAM so they follow you and your crew can see them.";
    foot.appendChild(msg);
    if (latest) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = "Save my picks";
      b.addEventListener("click", function () { goSave(latest.slug, total); });
      foot.appendChild(b);
    }
    box.appendChild(foot);
    var anchor = document.querySelector(".controls");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(box, anchor);
  }

  // ----- hub, members: For You (Your Season + artists on tour) + card badges -----
  function hubCards() {
    var out = {};
    var today = new Date().toISOString().slice(0, 10);
    Array.prototype.forEach.call(document.querySelectorAll(".event-card[href^='/lineup-explorer/']"), function (c) {
      var s = c.getAttribute("href").replace("/lineup-explorer/", "").replace(/\.html$/, "");
      out[s] = { el: c, href: c.getAttribute("href"), past: c.dataset.date ? c.dataset.date < today : false };
    });
    return out;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function initHubMember(m) {
    var cards = hubCards();
    if (!Object.keys(cards).length) return;
    var rid = m.raverId;
    window.LineupMember.client(function (sb) {
      Promise.all([
        sb.from("raver_festivals").select("festival_id").eq("raver_id", rid),
        sb.from("raver_festival_interest").select("festival_id").eq("raver_id", rid),
        sb.from("raver_artist_plans").select("festival_id").eq("raver_id", rid),
        sb.from("raver_favorite_artists").select("artist_id").eq("raver_id", rid)
      ]).then(function (out) {
        var rows = function (i) { return (out[i] && out[i].data) || []; };
        var status = {}, planN = {}, fids = {};
        rows(0).forEach(function (r) { status[r.festival_id] = "going"; fids[r.festival_id] = true; });
        rows(1).forEach(function (r) { if (!status[r.festival_id]) status[r.festival_id] = "interested"; fids[r.festival_id] = true; });
        rows(2).forEach(function (r) { planN[r.festival_id] = (planN[r.festival_id] || 0) + 1; fids[r.festival_id] = true; });
        var favIds = rows(3).map(function (r) { return r.artist_id; });
        var ids = Object.keys(fids);
        Promise.all([
          ids.length ? sb.from("festivals").select("id,slug,name,date").in("id", ids).is("deleted_at", null) : Promise.resolve({ data: [] }),
          favIds.length ? sb.from("artists").select("id,name,name_lower").in("id", favIds) : Promise.resolve({ data: [] })
        ]).then(function (res) {
          renderHubMember(cards, (res[0] && res[0].data) || [], status, planN, (res[1] && res[1].data) || []);
        }, noop);
      }, noop);
    });
  }

  // ----- hub, everyone: 🔥 Most wanted line per card + Most wanted sort (Phase 3a) -----
  // Counts come from get_lineup_hub_most_wanted(): members' live picks only,
  // 5+ only (enforced on the server).
  function initHubWanted() {
    var cards = hubCards();
    if (!Object.keys(cards).length) return;
    window.LineupMember.client(function (sb) {
      sb.rpc("get_lineup_hub_most_wanted").then(function (res) {
        var d = res && res.data;
        if (!d || !d.ok || !Array.isArray(d.fests) || !d.fests.length) return;
        var fans = {};
        d.fests.forEach(function (f) {
          var c = f && cards[f.slug];
          if (!c || c.past) return;
          if (f.fans) fans[f.slug] = f.fans;
          if (!f.top || !f.want) return;
          var row = el("div", "lp-hub-mw", "🔥 Most wanted: " + f.top + " (" + f.want + ")");
          c.el.insertBefore(row, c.el.querySelector(".event-footer") || null);
        });
        if (Object.keys(fans).length) addHubSort(cards, fans);
      }, noop);
    });
  }

  function addHubSort(cards, fans) {
    var grid = document.querySelector(".grid");
    var controls = document.querySelector(".controls");
    if (!grid || !controls || controls.querySelector(".lp-sort")) return;
    var order = Array.prototype.slice.call(grid.children);
    var b = el("button", "lp-sort", "🔥 Most wanted");
    b.type = "button";
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", function () {
      var on = b.getAttribute("aria-pressed") !== "true";
      b.setAttribute("aria-pressed", String(on));
      var list = order.slice();
      if (on) {
        var slugOf = function (c) {
          var h = c.getAttribute && c.getAttribute("href");
          return h ? h.replace("/lineup-explorer/", "").replace(/\.html$/, "") : "";
        };
        list = list.map(function (c, i) { return { c: c, i: i, n: fans[slugOf(c)] || 0 }; })
          .sort(function (x, y) { return y.n - x.n || x.i - y.i; })
          .map(function (x) { return x.c; });
      }
      list.forEach(function (c) { grid.appendChild(c); });
    });
    controls.appendChild(b);
  }

  function renderHubMember(cards, fests, status, planN, favArtists) {
    // ♡ favorites playing each explorer page, from the hub's artist index.
    var index = window.ARTIST_INDEX || [];
    var byKey = {};
    index.forEach(function (x) { byKey[x.name_lower] = x; });
    var favPlaying = {}; // slug -> [names]
    var tour = [];       // { name, fests: [{ slug, title }] }
    favArtists.forEach(function (a) {
      var x = byKey[a.name_lower];
      if (!x) return;
      var up = x.festivals.filter(function (f) { return cards[f.slug] && !cards[f.slug].past; });
      up.forEach(function (f) { (favPlaying[f.slug] = favPlaying[f.slug] || []).push(a.name); });
      if (up.length) tour.push({ name: a.name, fests: up });
    });
    tour.sort(function (x, y) { return y.fests.length - x.fests.length || (x.name < y.name ? -1 : 1); });

    // Card badges.
    var bySlug = {};
    fests.forEach(function (f) { if (f.slug) bySlug[f.slug] = f; });
    Object.keys(cards).forEach(function (slug) {
      var f = bySlug[slug];
      var st = f && status[f.id];
      var picks = f ? planN[f.id] || 0 : 0;
      var fav = favPlaying[slug] || [];
      if (!st && !picks && !fav.length) return;
      var row = el("div", "lp-badges");
      if (st) row.appendChild(el("span", "lp-b lp-b-" + st, st === "going" ? "🎟️ Going" : "👀 Interested"));
      if (picks) row.appendChild(el("span", "lp-b lp-b-picks", "📋 " + picks + (picks === 1 ? " pick" : " picks")));
      if (fav.length) row.appendChild(el("span", "lp-b lp-b-fav",
        "♡ " + fav.length + (fav.length === 1 ? " favorite playing: " : " favorites playing: ") +
        fav.slice(0, 3).join(", ") + (fav.length > 3 ? ", …" : "")));
      var c = cards[slug].el;
      c.insertBefore(row, c.querySelector(".event-footer") || null);
    });

    // Your Season: upcoming raves you're Going to or Interested in.
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var season = fests.filter(function (f) { return status[f.id] && cards[f.slug] && !cards[f.slug].past; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (!season.length && !tour.length) return;

    var box = el("section", "lp-foryou");
    box.setAttribute("aria-labelledby", "lpForYouTitle");
    var h = el("h2", null, "For you");
    h.id = "lpForYouTitle";
    box.appendChild(h);

    if (season.length) {
      box.appendChild(el("h3", null, "Your season"));
      var ul = el("ul", "lp-season");
      season.forEach(function (f) {
        var li = el("li");
        var st = status[f.id];
        li.appendChild(el("span", "lp-b lp-b-" + st, st === "going" ? "Going" : "Interested"));
        var a = el("a", "lp-season-name", f.name);
        a.href = cards[f.slug].href;
        li.appendChild(a);
        var parts = [];
        if (f.date) {
          var p = f.date.split("-").map(Number);
          var days = Math.round((new Date(p[0], p[1] - 1, p[2]) - today) / 86400000);
          parts.push(days > 1 ? "in " + days + " days" : days === 1 ? "tomorrow" : days === 0 ? "today" : "on now");
        }
        if (planN[f.id]) parts.push("📋 " + planN[f.id]);
        if (favPlaying[f.slug]) parts.push("♡ " + favPlaying[f.slug].length);
        li.appendChild(el("span", "lp-season-meta", parts.join(" · ")));
        var open = el("a", "lp-season-open", "Open in RaveFAM");
        open.href = "/app?rave=" + encodeURIComponent(f.slug);
        li.appendChild(open);
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }

    if (tour.length) {
      box.appendChild(el("h3", null, "Your artists on tour"));
      var wrap = el("div", "lp-tour");
      tour.slice(0, 24).forEach(function (t, i) {
        var chip = el("button", "lp-tour-chip");
        chip.type = "button";
        chip.setAttribute("aria-expanded", "false");
        var listId = "lpTour" + i;
        chip.setAttribute("aria-controls", listId);
        chip.appendChild(document.createTextNode("♡ " + t.name + " "));
        chip.appendChild(el("b", null, String(t.fests.length)));
        var list = el("ul", "lp-tour-list");
        list.id = listId;
        list.hidden = true;
        t.fests.forEach(function (f) {
          var li = el("li");
          var a = el("a", null, f.title);
          a.href = cards[f.slug].href + "?q=" + encodeURIComponent(t.name);
          li.appendChild(a);
          list.appendChild(li);
        });
        chip.addEventListener("click", function () {
          var open = list.hidden;
          list.hidden = !open;
          chip.setAttribute("aria-expanded", String(open));
        });
        var item = el("div", "lp-tour-item");
        item.appendChild(chip);
        item.appendChild(list);
        wrap.appendChild(item);
      });
      box.appendChild(wrap);
    }

    var anchor = document.querySelector(".lp-hub") || document.querySelector(".controls");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(box, anchor);
  }

  // ----- member writes -----
  function planRows(ids) {
    var seen = {};
    return ids.filter(function (id) { if (seen[id]) return false; seen[id] = true; return true; })
      .map(function (id) { return { raver_id: member.raverId, artist_id: id, festival_id: member.festival.id }; });
  }

  function upsertPlans(ids, done) {
    window.LineupMember.client(function (sb) {
      sb.from("raver_artist_plans")
        .upsert(planRows(ids), { onConflict: "raver_id,artist_id,festival_id", ignoreDuplicates: true })
        .then(function (res) { done(!res.error); }, function () { done(false); });
    });
  }

  function setPlan(a, on) {
    var ids = actIds(a);
    if (on) {
      ids.forEach(function (id) { plans[id] = true; });
      upsertPlans(ids, function (ok) {
        if (ok) return;
        ids.forEach(function (id) { delete plans[id]; });
        toast("⚠️ Couldn't save that pick. Try again.");
        refresh();
      });
      return;
    }
    // Keep an artist's plan if another picked act still needs it
    // (e.g. "Prospa" stays picked when "Prospa b2b Josh Baker" is removed).
    var keep = {};
    acts.forEach(function (o) {
      if (o === a || !isPicked(o)) return;
      (actIds(o) || []).forEach(function (id) { keep[id] = true; });
    });
    var drop = ids.filter(function (id) { return !keep[id]; });
    drop.forEach(function (id) { delete plans[id]; });
    if (!drop.length) return;
    window.LineupMember.client(function (sb) {
      sb.from("raver_artist_plans").delete()
        .eq("raver_id", member.raverId).eq("festival_id", member.festival.id).in("artist_id", drop)
        .then(function (res) {
          if (!res.error) return;
          drop.forEach(function (id) { plans[id] = true; });
          toast("⚠️ Couldn't remove that pick. Try again.");
          refresh();
        }, noop);
    });
  }

  // Moves browser-held picks for this page into raver_artist_plans. Acts
  // whose artists aren't in the database yet stay in the browser.
  function flushLocal(done) {
    var ids = [], moved = [], keep = [];
    local.forEach(function (name) {
      var got = actIds({ name: name });
      if (got) { ids = ids.concat(got); moved.push(name); } else { keep.push(name); }
    });
    if (!ids.length) { done(0); return; }
    upsertPlans(ids, function (ok) {
      if (!ok) { done(-1); return; }
      ids.forEach(function (id) { plans[id] = true; });
      local = keep;
      saveLocal();
      done(moved.length);
    });
  }

  function writeRsvp(v, done) {
    var fid = member.festival.id, rid = member.raverId;
    var add = v === "going" ? "raver_festivals" : "raver_festival_interest";
    var other = v === "going" ? "raver_festival_interest" : "raver_festivals";
    window.LineupMember.client(function (sb) {
      sb.from(add)
        .upsert([{ raver_id: rid, festival_id: fid }], { onConflict: "raver_id,festival_id", ignoreDuplicates: true })
        .then(function (res) {
          if (res.error) { done(false, res.error); return; }
          sb.from(other).delete().eq("raver_id", rid).eq("festival_id", fid).then(noop, noop);
          logEvent("first_rsvp_updated", { festival_id: fid, direction: v, source: "explorer" });
          done(true);
        }, function (err) { done(false, err); });
    });
  }

  // ----- first-star sheet (members) -----
  var sheetEl = null, sheetLastFocus = null;
  function askedKey() { return "rf_picks_asked_" + slug; }
  function asked() { try { return !!window.sessionStorage.getItem(askedKey()); } catch (e) { return false; } }
  function markAsked() { try { window.sessionStorage.setItem(askedKey(), "1"); } catch (e) {} }

  function openSheet(actName) {
    if (!isMemberMode()) return;
    markAsked();
    var fest = member.festival.name || "this rave";
    if (!sheetEl) {
      sheetEl = document.createElement("div");
      sheetEl.className = "lp-overlay";
      sheetEl.innerHTML =
        '<div class="lp-sheet" role="dialog" aria-modal="true" aria-labelledby="lpSheetTitle">' +
          '<div class="lp-sheet-top"><span class="lp-badge">RaveFAM</span>' +
          '<button type="button" class="lp-x" aria-label="Close">✕</button></div>' +
          '<h3 id="lpSheetTitle"></h3>' +
          '<p class="lp-sub">We only ask once per rave. You can change it anytime.</p>' +
          '<div class="lp-actions">' +
            '<button type="button" class="lp-opt lp-going" data-v="going">🎟️ I\'m going</button>' +
            '<button type="button" class="lp-opt lp-int" data-v="interested">👀 Interested</button>' +
            '<button type="button" class="lp-opt lp-browse" data-v="browse">Just browsing</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(sheetEl);
      sheetEl.addEventListener("click", function (e) {
        if (e.target === sheetEl || e.target.closest(".lp-x")) { answer("browse"); return; }
        var b = e.target.closest(".lp-opt");
        if (b) answer(b.dataset.v);
      });
      sheetEl.addEventListener("keydown", function (e) { if (e.key === "Escape") answer("browse"); });
    }
    var title = sheetEl.querySelector("#lpSheetTitle");
    title.textContent = (actName ? actName + " added to your picks. " : "") + "Are you going to " + fest + "?";
    sheetEl.querySelectorAll(".lp-opt").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.v === rsvp));
      b.disabled = false;
    });
    sheetLastFocus = document.activeElement;
    sheetEl.classList.add("show");
    var first = sheetEl.querySelector(".lp-going");
    if (first) first.focus();
  }

  function closeSheet() {
    if (!sheetEl) return;
    sheetEl.classList.remove("show");
    if (sheetLastFocus && sheetLastFocus.focus && document.body.contains(sheetLastFocus)) sheetLastFocus.focus();
  }

  function answer(v) {
    var fest = member.festival.name || "this rave";
    if (v === "browse" || v === rsvp) {
      closeSheet();
      if (v === "browse" && !rsvp && local.length) toast("Picks kept on this device for now.");
      return;
    }
    sheetEl.querySelectorAll(".lp-opt").forEach(function (b) { b.disabled = true; });
    writeRsvp(v, function (ok, err) {
      if (!ok) {
        sheetEl.querySelectorAll(".lp-opt").forEach(function (b) { b.disabled = false; });
        var blocked = err && /RSVP_BLOCKED/.test(err.message || "");
        toast(blocked ? "🔒 That RSVP is blocked for this rave." : "⚠️ Couldn't save that. Try again.");
        return;
      }
      rsvp = v;
      closeSheet();
      flushLocal(function (n) {
        var lead = v === "going" ? "✅ You're going to " + fest + "!" : "👀 Watching " + fest + ".";
        var tail = n > 0 ? " " + n + (n === 1 ? " pick" : " picks") + " saved." : n < 0 ? " Picks are still on this device." : "";
        toast(lead + tail, "Change", function () { openSheet(null); });
        refresh();
      });
    });
  }

  // ----- tapping ☆ -----
  function toggle(a) {
    var was = isPicked(a);
    var inLocal = local.indexOf(a.name) !== -1;
    if (was) {
      if (inLocal) { local = local.filter(function (n) { return n !== a.name; }); saveLocal(); }
      if (isMemberMode() && actIds(a) && actIds(a).every(function (id) { return plans[id]; })) setPlan(a, false);
      refresh(a);
      return;
    }
    if (isMemberMode() && rsvp && actIds(a)) {
      setPlan(a, true);
      refresh(a);
      return;
    }
    local.push(a.name);
    saveLocal();
    refresh(a);
    if (isMemberMode()) {
      if (!asked()) openSheet(a.name);
      else toast("📋 Saved on this device.", "Add to RaveFAM", function () { openSheet(null); });
      return;
    }
    var tipped = false;
    try { tipped = !!window.localStorage.getItem(TIP_KEY); window.localStorage.setItem(TIP_KEY, "1"); } catch (e) {}
    if (!tipped) toast("📋 " + a.name + " added to your picks on this device.", "Save to RaveFAM", function () { goSave(); });
  }

  // ----- picks bar + signup banner -----
  function renderBar() {
    if (!barEl) return;
    var picked = pickedActs();
    var n = picked.length;
    var days = {}, order = [];
    picked.forEach(function (a) {
      if (!a.night) return;
      if (!days[a.night]) { days[a.night] = 0; order.push(a.night); }
      days[a.night]++;
    });
    barEl.dataset.mode = isMemberMode() ? "member" : "visitor";
    barEl.dataset.rsvp = rsvp || "";
    ["all", "picks", "favs", "crew", "shared"].forEach(function (v) {
      barEl.querySelector('[data-v="' + v + '"]').setAttribute("aria-pressed", String(view === v));
    });
    var member = isMemberMode();
    barEl.querySelector('[data-v="favs"]').hidden = !member;
    var crewN = member ? acts.filter(function (a) { return actCrew(a).length; }).length : 0;
    barEl.querySelector('[data-v="crew"]').hidden = !crewN && view !== "crew";
    barEl.querySelector(".lp-nc").textContent = crewN;
    var shBtn = barEl.querySelector('[data-v="shared"]');
    shBtn.hidden = !shared;
    if (shared) {
      shBtn.querySelector(".lp-sn").textContent = shared.first + "'s picks";
      shBtn.querySelector(".lp-nsh").textContent = shared.n;
    }
    barEl.querySelector(".lp-share").hidden = !member || !rsvp;
    var sortBtn = barEl.querySelector(".lp-sort");
    sortBtn.hidden = !member;
    sortBtn.setAttribute("aria-pressed", String(sortWanted));
    var favN = member ? acts.filter(isFav).length : 0;
    barEl.querySelector(".lp-nf").textContent = favN;
    var meta = [];
    if (member && favN) meta.push(favN + (favN === 1 ? " of your favorites plays here" : " of your favorites play here"));
    var goingHere = member ? crewHere().filter(function (m) { return m.s === "going"; }).length : 0;
    if (goingHere) meta.push(goingHere + " crew going");
    var metaEl = barEl.querySelector(".lp-meta");
    metaEl.textContent = meta.join(" · ");
    metaEl.hidden = !meta.length;
    barEl.querySelector(".lp-n").textContent = n;
    barEl.querySelector(".lp-days").textContent = order.map(function (k) {
      return String(k).toUpperCase() + " " + days[k];
    }).join(" · ");

    renderCrewPanel();
    renderMostWanted();
    renderShareBanner();
    var msg = "", btn = "";
    if (view === "picks" && local.length) {
      if (!member) {
        msg = "Your picks only live on this device. Save them to RaveFAM so they follow you and your crew can see them.";
        btn = "Save my picks";
      } else if (isMemberMode() && !rsvp) {
        msg = "These picks stay on this device until you're Going or Interested.";
        btn = "Choose";
      }
    } else if (view === "picks" && !n) {
      msg = "Tap 📋 on any artist to add it to your picks.";
    } else if (view === "favs" && !favN) {
      msg = "Tap ♡ on an artist to follow them across every lineup.";
    }
    saveEl.hidden = !msg;
    saveEl.querySelector(".lp-save-msg").textContent = msg;
    var b = saveEl.querySelector("button");
    b.hidden = !btn;
    b.textContent = btn;
  }

  function buildBar() {
    var anchor = document.getElementById("count") || document.getElementById("deck");
    if (!anchor || !anchor.parentNode) return;
    barEl = document.createElement("div");
    barEl.className = "lp-bar";
    barEl.setAttribute("role", "group");
    barEl.setAttribute("aria-label", "Show all artists or only your picks");
    barEl.innerHTML =
      '<button type="button" class="lp-f" data-v="all">All artists</button>' +
      '<button type="button" class="lp-f" data-v="picks"><span aria-hidden="true">📋</span> My picks <b class="lp-n">0</b></button>' +
      '<button type="button" class="lp-f lp-fav-f" data-v="favs" hidden><span aria-hidden="true">♡</span> Favorites <b class="lp-nf">0</b></button>' +
      '<button type="button" class="lp-f lp-crew-f" data-v="crew" hidden><span aria-hidden="true">👥</span> Crew picks <b class="lp-nc">0</b></button>' +
      '<button type="button" class="lp-f lp-shared-f" data-v="shared" hidden><span aria-hidden="true">📋</span> <span class="lp-sn"></span> <b class="lp-nsh">0</b></button>' +
      '<button type="button" class="lp-share" hidden>📤 Share my picks</button>' +
      '<button type="button" class="lp-sort" hidden aria-pressed="false">🔥 Most wanted</button>' +
      '<span class="lp-days"></span>' +
      '<span class="lp-meta" hidden></span>';
    barEl.addEventListener("click", function (e) {
      if (e.target.closest(".lp-sort")) { sortWanted = !sortWanted; refresh(); return; }
      if (e.target.closest(".lp-share")) { openShareSheet(); return; }
      var b = e.target.closest(".lp-f");
      if (!b) return;
      view = b.dataset.v;
      refresh();
    });
    saveEl = document.createElement("div");
    saveEl.className = "lp-save";
    saveEl.hidden = true;
    saveEl.innerHTML = '<span class="lp-save-msg"></span><button type="button"></button>';
    saveEl.querySelector("button").addEventListener("click", function () {
      if (!member) goSave(); else openSheet(null);
    });
    anchor.parentNode.insertBefore(barEl, anchor);
    anchor.parentNode.insertBefore(saveEl, anchor);
  }

  function refresh(focusAct, sel) {
    renderBar();
    if (onRender) onRender();
    sortDeck();
    if (focusAct) {
      var btns = document.querySelectorAll(sel || focusSel || ".pick");
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].dataset.n === focusAct.name) { btns[i].focus(); break; }
      }
    }
  }

  function loadWantCounts() {
    if (!slug) return;
    window.LineupMember.client(function (sb) {
      sb.rpc("get_lineup_want_counts", { p_slug: slug }).then(function (res) {
        var d = res && res.data;
        if (!d || !d.ok || !Array.isArray(d.artists) || !d.artists.length) return;
        d.artists.forEach(function (x) {
          if (!x || !x.name) return;
          var k = String(x.name).toLowerCase();
          wantByKey[k] = { want: x.want, gain_7d: x.gain_7d };
          wantTop.push({ key: k, want: x.want, gain_7d: x.gain_7d });
          if (x.want > wantMax) wantMax = x.want;
        });
        refresh();
      }, noop);
    });
  }

  // ----- sharing (Phase 2b) -----
  // Owner: one link per raver per festival (?by=<token>) from
  // get_or_create_share_link; Copy / phone share / Post to a crew Huddle /
  // Turn off. Viewer: get_shared_lineup(token) returns the sharer's first
  // name and picks for this page only.
  var shared = null;       // { first, keys: { name_lower: true }, n }
  var sharedGone = false;  // link was turned off or expired
  var shareSheet = null;

  function isShared(a) {
    return !!shared && splitKeys(a.name).every(function (k) { return shared.keys[k]; });
  }

  function loadShared(token) {
    window.LineupMember.client(function (sb) {
      sb.rpc("get_shared_lineup", { p_token: token }).then(function (res) {
        var d = res && res.data;
        if (!d || !d.ok || d.slug !== slug) { sharedGone = true; refresh(); return; }
        var keys = {}, n = 0;
        (d.artists || []).forEach(function (nm) { keys[String(nm).toLowerCase()] = true; });
        acts.forEach(function (a) { if (splitKeys(a.name).every(function (k) { return keys[k]; })) n++; });
        shared = { first: d.first_name || "A friend", keys: keys, n: n };
        logEvent("lineup_share_opened", { slug: slug, picks: n });
        refresh();
      }, noop);
    });
  }

  var shareBannerEl = null;
  function renderShareBanner() {
    if (!barEl) return;
    if (!shareBannerEl) {
      shareBannerEl = document.createElement("div");
      shareBannerEl.className = "lp-sharebanner";
      shareBannerEl.setAttribute("role", "status");
      var anchor = document.querySelector(".lp-crew") || barEl;
      anchor.parentNode.insertBefore(shareBannerEl, anchor);
    }
    shareBannerEl.innerHTML = "";
    if (sharedGone) {
      shareBannerEl.hidden = false;
      shareBannerEl.appendChild(document.createTextNode("This shared lineup was turned off or has expired."));
      return;
    }
    if (!shared) { shareBannerEl.hidden = true; return; }
    shareBannerEl.hidden = false;
    var t = document.createElement("span");
    t.className = "lp-sharebanner-msg";
    t.textContent = "📋 " + shared.first + " shared their picks" + (shared.n ? " (" + shared.n + ")" : "") + ".";
    shareBannerEl.appendChild(t);
    if (!member) {
      var j = document.createElement("button");
      j.type = "button";
      j.textContent = "Join " + shared.first + " on RaveFAM";
      j.addEventListener("click", function () {
        if (local.length) goSave(); else location.href = "/app";
      });
      shareBannerEl.appendChild(j);
    }
  }

  function shareUrl(token) {
    return location.origin + "/lineup-explorer/" + slug + "?by=" + encodeURIComponent(token);
  }

  function openShareSheet() {
    if (!isMemberMode()) return;
    window.LineupMember.client(function (sb) {
      sb.rpc("get_or_create_share_link", { p_festival_id: member.festival.id }).then(function (res) {
        var d = res && res.data;
        if (!d || !d.ok || !d.token) { toast("⚠️ Couldn't make a share link. Try again."); return; }
        logEvent("lineup_share_created", { slug: slug, picks: pickedActs().length });
        showShareSheet(sb, d.token);
      }, function () { toast("⚠️ Couldn't make a share link. Try again."); });
    });
  }

  function showShareSheet(sb, token) {
    var url = shareUrl(token);
    var fest = member.festival.name || "this rave";
    if (!shareSheet) {
      shareSheet = document.createElement("div");
      shareSheet.className = "lp-overlay lp-share-overlay";
      shareSheet.addEventListener("click", function (e) { if (e.target === shareSheet) closeShareSheet(); });
      shareSheet.addEventListener("keydown", function (e) { if (e.key === "Escape") closeShareSheet(); });
      document.body.appendChild(shareSheet);
    }
    shareSheet.innerHTML =
      '<div class="lp-sheet" role="dialog" aria-modal="true" aria-labelledby="lpShareTitle">' +
        '<div class="lp-sheet-top"><span class="lp-badge">RaveFAM</span>' +
        '<button type="button" class="lp-x" aria-label="Close">✕</button></div>' +
        '<h3 id="lpShareTitle"></h3>' +
        '<p class="lp-sub">Anyone with the link sees your first name and your picks for this rave. It updates as your picks change and stops working 30 days after the rave.</p>' +
        '<div class="lp-share-url"><input type="text" readonly aria-label="Share link"><button type="button" class="lp-copy">Copy link</button></div>' +
        '<div class="lp-share-actions"></div>' +
        '<div class="lp-share-crews" hidden><p class="lp-share-label">Post to a crew Huddle</p><div class="lp-share-crew-list"></div></div>' +
        '<button type="button" class="lp-opt lp-browse lp-share-off">Turn off this link</button>' +
      '</div>';
    shareSheet.querySelector("#lpShareTitle").textContent = "Share your " + fest + " picks";
    var input = shareSheet.querySelector("input");
    input.value = url;
    shareSheet.querySelector(".lp-x").addEventListener("click", closeShareSheet);
    shareSheet.querySelector(".lp-copy").addEventListener("click", function () {
      var done = function () { toast("🔗 Link copied."); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { input.select(); });
      else { input.select(); try { document.execCommand("copy"); done(); } catch (e) {} }
    });
    var actions = shareSheet.querySelector(".lp-share-actions");
    if (navigator.share) {
      var sh = document.createElement("button");
      sh.type = "button";
      sh.className = "lp-opt";
      sh.textContent = "📤 Share…";
      sh.addEventListener("click", function () {
        navigator.share({ title: "My " + fest + " picks", url: url }).then(noop, noop);
      });
      actions.appendChild(sh);
    }
    shareSheet.querySelector(".lp-share-off").addEventListener("click", function () {
      sb.rpc("turn_off_share_link", { p_festival_id: member.festival.id }).then(function (res) {
        if (res && res.data && res.data.ok) { closeShareSheet(); toast("Link turned off. Old links won't open your picks."); }
        else toast("⚠️ Couldn't turn the link off. Try again.");
      }, noop);
    });
    // Crews you can post in (crews RLS already limits this to crews you lead
    // or belong to that aren't Secret).
    sb.from("crews").select("id,name").is("deleted_at", null).then(function (res) {
      var rows = (res && res.data) || [];
      if (!rows.length) return;
      var box = shareSheet.querySelector(".lp-share-crews");
      var list = box.querySelector(".lp-share-crew-list");
      rows.forEach(function (c) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "lp-opt lp-share-crew";
        b.textContent = "💬 " + c.name;
        b.addEventListener("click", function () { postToHuddle(sb, c, url, b); });
        list.appendChild(b);
      });
      box.hidden = false;
    }, noop);
    shareSheet.classList.add("show");
    var first = shareSheet.querySelector(".lp-copy");
    if (first) first.focus();
  }

  function closeShareSheet() { if (shareSheet) shareSheet.classList.remove("show"); }

  // Same two steps as app.html's postHuddleSystemMessage: materialize the
  // crew's room for this rave (upsert, ignore duplicates), look it up, post.
  function postToHuddle(sb, c, url, btn) {
    var fid = member.festival.id;
    var names = pickedActs().map(function (a) { return a.name; });
    var body = "📋 My picks for " + (member.festival.name || "this rave") + ": " +
      (names.length ? names.slice(0, 5).join(", ") + (names.length > 5 ? " +" + (names.length - 5) : "") : "none yet");
    var roomKey = "festival:" + fid;
    btn.disabled = true;
    sb.from("huddle_rooms").upsert([{
      crew_id: c.id, created_by: member.userId, room_key: roomKey, kind: "festival",
      name: (member.festival.name || "Rave") + " Huddle", festival_id: fid
    }], { onConflict: "crew_id,room_key", ignoreDuplicates: true }).then(function () {
      return sb.from("huddle_rooms").select("id").eq("crew_id", c.id).eq("room_key", roomKey).limit(1);
    }).then(function (res) {
      var room = res && res.data && res.data[0];
      if (!room) throw new Error("no room");
      return sb.from("huddle_messages").insert({
        room_id: room.id, crew_id: c.id, sender_id: member.userId, kind: "lineup", body: body, media_url: url
      });
    }).then(function (res) {
      if (res && res.error) throw res.error;
      btn.textContent = "✅ Posted to " + c.name;
      logEvent("lineup_share_posted", { slug: slug, picks: names.length });
    }).catch(function () {
      btn.disabled = false;
      toast("⚠️ Couldn't post to " + c.name + ". Try again.");
    });
  }

  // ----- member load -----
  function loadMember() {
    window.LineupMember.ready(function (m) {
      if (!m || !m.isMember) return;
      member = m;
      if (!m.raverId || !m.festival) { refresh(); return; }
      var keys = {};
      acts.forEach(function (a) { splitKeys(a.name).forEach(function (k) { keys[k] = true; }); });
      window.LineupMember.client(function (sb) {
        var fid = m.festival.id, rid = m.raverId;
        Promise.all([
          sb.from("artists").select("id,name_lower").in("name_lower", Object.keys(keys)),
          sb.from("raver_artist_plans").select("artist_id").eq("raver_id", rid).eq("festival_id", fid),
          sb.from("raver_festivals").select("festival_id").eq("raver_id", rid).eq("festival_id", fid),
          sb.from("raver_festival_interest").select("festival_id").eq("raver_id", rid).eq("festival_id", fid),
          sb.from("raver_favorite_artists").select("artist_id").eq("raver_id", rid),
          sb.rpc("get_lineup_crew_pulse", { p_festival_id: fid })
        ]).then(function (out) {
          ((out[4] && out[4].data) || []).forEach(function (r) { favs[r.artist_id] = true; });
          var cp = out[5] && out[5].data;
          crew = cp && cp.ok ? cp : null;
          ((out[0] && out[0].data) || []).forEach(function (r) { idsByKey[r.name_lower] = r.id; });
          ((out[1] && out[1].data) || []).forEach(function (r) { plans[r.artist_id] = true; });
          rsvp = (out[2].data || []).length ? "going" : (out[3].data || []).length ? "interested" : null;
          memberLoaded = true;
          refresh();
          if (!local.length) return;
          if (rsvp) {
            flushLocal(function (n) { if (n > 0) toast("📋 " + n + (n === 1 ? " pick" : " picks") + " synced to your RaveFAM."); refresh(); });
          } else if (!asked()) {
            setTimeout(function () { openSheet(null); }, 900);
          }
        }, function () { refresh(); });
      });
    });
  }

  window.LineupPicks = {
    init: function (list, render) {
      slug = window.LineupMember ? window.LineupMember.pageSlug() : null;
      acts = list || [];
      onRender = render;
      var saved = slug ? readAll()[slug] : null;
      var names = {};
      acts.forEach(function (a) { names[a.name] = true; });
      local = saved && Array.isArray(saved.n) ? saved.n.filter(function (n) { return names[n]; }) : [];
      buildBar();
      renderBar();
      watchDeck();
      loadWantCounts();
      loadMember();
      var by = null;
      try { by = new URLSearchParams(location.search).get("by"); } catch (e) {}
      if (by && /^[a-z0-9-]{4,40}$/.test(by)) loadShared(by);
    },
    ok: function (a) {
      if (view === "all") return true;
      if (view === "shared") return isShared(a);
      if (view === "picks") return isPicked(a);
      if (view === "crew") return actCrew(a).length > 0;
      return isFav(a);
    },
    wrap: function (el, a) {
      var picked = isPicked(a);
      var w = document.createElement("div");
      w.className = "act-wrap" + (picked ? " picked" : "");
      var b = document.createElement("button");
      b.type = "button";
      b.className = "pick";
      b.dataset.n = a.name;
      b.setAttribute("aria-pressed", String(picked));
      b.setAttribute("aria-label", picked ? "Remove " + a.name + " from my picks" : "Add " + a.name + " to my picks");
      b.innerHTML = picked ? CLIP_ON : CLIP_OFF;
      b.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); toggle(a); });
      if (isShared(a)) {
        var sp = document.createElement("div");
        sp.className = "lp-shared";
        sp.textContent = "📋 " + (picked ? "You both picked this" : shared.first + " picked this");
        el.insertBefore(sp, el.querySelector(".foot"));
      }
      var pulse = pulseEl(a);
      if (pulse) el.insertBefore(pulse, el.querySelector(".foot"));
      w.appendChild(el);
      w.appendChild(b);
      // The crew tray sits under the card in an outer cell, so ♡/📋 stay
      // anchored to the card itself.
      var tray = crewTrayEl(a);
      if (isMemberMode()) {
        var fav = isFav(a);
        var h = document.createElement("button");
        h.type = "button";
        h.className = "fav";
        h.dataset.n = a.name;
        h.setAttribute("aria-pressed", String(fav));
        h.setAttribute("aria-label", fav ? "Remove " + a.name + " from favorites" : "Add " + a.name + " to favorites");
        h.innerHTML = '<span aria-hidden="true">' + (fav ? "♥" : "♡") + "</span>";
        h.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); toggleFav(a); });
        w.appendChild(h);
        w.classList.add("member");
        if (fav) w.classList.add("faved");
      }
      if (!tray) return w;
      var cell = document.createElement("div");
      cell.className = "act-cell";
      cell.appendChild(w);
      cell.appendChild(tray);
      return cell;
    },
    all: readAll
  };

  // ----- header: Log in (visitors) / My RaveFAM (members) -----
  // Sits in the .brandbar next to 📲 Save. A visitor with ☆ picks logs in
  // through the Save my picks handoff, so the picks come along; otherwise it
  // simply opens /app. Members get a link back to the app.
  function injectAccountButton() {
    var bar = document.querySelector(".brandbar");
    if (!bar || bar.querySelector(".lp-account")) return;
    var a = document.createElement("a");
    a.className = "lp-account";
    a.href = "/app";
    a.textContent = "Log in";
    a.addEventListener("click", function (e) {
      if (a.dataset.member) return;
      var all = readAll(), n = 0, latest = null;
      Object.keys(all).forEach(function (k) {
        var p = all[k];
        var c = p && Array.isArray(p.n) ? p.n.length : 0;
        if (!c) return;
        n += c;
        if (!latest || (p.at || "") > (all[latest].at || "")) latest = k;
      });
      if (!n) return;
      e.preventDefault();
      goSave(slug && all[slug] && all[slug].n && all[slug].n.length ? slug : latest, n);
    });
    // Join the right-hand group (📲 Save + year) rather than adding a third
    // child to the space-between brandbar.
    var group = bar.querySelector(".a2hs-yr-wrap");
    if (!group) {
      var right = bar.querySelector(".a2hs-btn") || bar.querySelector(".yr");
      group = document.createElement("span");
      group.className = "a2hs-yr-wrap";
      if (right) { right.parentNode.insertBefore(group, right); group.appendChild(right); }
      else bar.appendChild(group);
    }
    group.insertBefore(a, group.firstChild);
    window.LineupMember.ready(function (m) {
      if (!m || !m.isMember) return;
      a.dataset.member = "1";
      a.textContent = "My RaveFAM";
      a.classList.add("is-member");
    });
  }
  if (window.LineupMember) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", injectAccountButton);
    else injectAccountButton();
  }

  if (window.LineupMember && !window.LineupMember.pageSlug()) {
    var startHub = function () {
      initHub();
      initHubWanted();
      window.LineupMember.ready(function (m) { if (m && m.isMember && m.raverId) initHubMember(m); });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startHub);
    else startHub();
  }
})();
