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
