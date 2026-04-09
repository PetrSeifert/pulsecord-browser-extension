(function(root, factory) {
  const site = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = site;
  }
  if (root.DrpcSiteRegistry) {
    root.DrpcSiteRegistry.registerSite(site);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  const LOGO_URL = "https://cdn.rcd.gg/PreMiD/websites/0-9/9anime/assets/logo.png";

  function createBrowsingCard(nowUnixSeconds, details, state, url, assets) {
    return {
      details,
      state: state || "Browsing 9anime",
      statusDisplayType: "details",
      showElapsedTime: true,
      startedAtUnixSeconds: nowUnixSeconds,
      assets: Object.assign({
        largeImage: LOGO_URL,
        largeText: "9anime",
        largeUrl: url
      }, assets || {}),
      buttons: [
        {
          label: "Open 9anime",
          url
        }
      ]
    };
  }

  function getAnimeTitle(documentRef) {
    const element = documentRef.querySelector(".film-infor .film-name.dynamic-name");
    if (element && element.textContent) {
      return element.textContent.trim();
    }

    return String(documentRef.title || "")
      .replace(/^Watch /i, "")
      .replace(/ online free on 9anime$/i, "")
      .trim();
  }

  function getEpisodeLabel(documentRef) {
    const activeEpisode = documentRef.querySelector(".ep-item.active");
    if (!activeEpisode) {
      return "";
    }

    const rawText = String(activeEpisode.textContent || "").replace(/\s+/g, " ").trim();
    if (rawText && !/^ep$/i.test(rawText)) {
      return rawText.startsWith("Episode ") ? rawText : `Episode ${rawText}`;
    }

    const dataNumber = activeEpisode.dataset && activeEpisode.dataset.number;
    if (dataNumber) {
      return `Episode ${dataNumber}`;
    }

    const order = activeEpisode.querySelector(".order");
    if (order && order.textContent) {
      return `Episode ${order.textContent.trim()}`;
    }

    return "";
  }

  function getCoverArt(documentRef) {
    const image = documentRef.querySelector(".anime-poster img");
    return image && image.src ? image.src : LOGO_URL;
  }

  function getSearchQuery(search) {
    const params = new URLSearchParams(search || "");
    return params.get("keyword") || params.get("q") || "";
  }

  return {
    metadata: {
      id: "9anime",
      name: "9anime",
      matches: ["https://*.9animetv.to/*"]
    },
    collectActivity(context) {
      const pathname = context.location.pathname || "/";
      const nowUnixSeconds = context.nowUnixSeconds;

      if (pathname === "/" || pathname === "/home") {
        return {
          pageTitle: "9anime",
          activityCard: createBrowsingCard(nowUnixSeconds, "Viewing Homepage", "Browsing 9anime", context.location.href)
        };
      }

      if (pathname === "/search") {
        const query = getSearchQuery(context.location.search).replace(/\+/g, " ").trim();
        if (!query) {
          return null;
        }
        return {
          pageTitle: `Search: ${query}`,
          activityCard: createBrowsingCard(nowUnixSeconds, `Viewing results: ${query}`, "Searching 9anime", context.location.href)
        };
      }

      if (pathname.includes("/genre/")) {
        const genre = pathname.split("/")[2] || "";
        if (!genre) {
          return null;
        }
        return {
          pageTitle: `Genre: ${genre}`,
          activityCard: createBrowsingCard(nowUnixSeconds, `Viewing genre: ${genre}`, "Browsing 9anime", context.location.href)
        };
      }

      if (pathname.includes("/watch/")) {
        const title = getAnimeTitle(context.document);
        if (!title) {
          return null;
        }

        const episodeLabel = getEpisodeLabel(context.document);
        const coverArt = getCoverArt(context.document);
        const playing = context.playbackState === "playing";

        return {
          pageTitle: title,
          activityCard: {
            name: title,
            details: title,
            state: episodeLabel || "Watching on 9anime",
            statusDisplayType: "details",
            showElapsedTime: Boolean(playing && context.playbackTimestamps.startedAtUnixSeconds),
            startedAtUnixSeconds: playing ? context.playbackTimestamps.startedAtUnixSeconds : null,
            endAtUnixSeconds: playing ? context.playbackTimestamps.endAtUnixSeconds : null,
            assets: {
              largeImage: coverArt,
              largeText: episodeLabel || "9anime",
              largeUrl: context.location.href,
              smallText: playing ? "Playing" : "Paused"
            },
            buttons: [
              {
                label: "Watch Anime",
                url: context.location.href
              }
            ]
          }
        };
      }

      if (pathname === "/movie" || pathname === "/tv" || pathname === "/ova" || pathname === "/ona" || pathname === "/special" || pathname === "/recently-updated" || pathname === "/recently-added" || pathname === "/ongoing" || pathname === "/upcoming") {
        const labels = {
          "/movie": "Browsing movies",
          "/tv": "Browsing TV series",
          "/ova": "Browsing OVAs",
          "/ona": "Browsing ONAs",
          "/special": "Browsing specials",
          "/recently-updated": "Browsing recently updated anime",
          "/recently-added": "Browsing recently added anime",
          "/ongoing": "Browsing ongoing anime",
          "/upcoming": "Viewing upcoming anime"
        };

        return {
          pageTitle: labels[pathname],
          activityCard: createBrowsingCard(nowUnixSeconds, `${labels[pathname]}...`, "Browsing 9anime", context.location.href)
        };
      }

      return null;
    }
  };
});
