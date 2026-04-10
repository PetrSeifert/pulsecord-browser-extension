(function(root, factory) {
  const site = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = site;
  }
  if (root.DrpcSiteRegistry) {
    root.DrpcSiteRegistry.registerSite(site);
  }
})(
  globalThis as DrpcGlobalRoot,
  function(): DrpcSiteDefinition {
    const LOGO_URL = "https://cdn.rcd.gg/PreMiD/websites/0-9/9anime/assets/logo.png";
    const PLAYING_ASSET = "playing";
    const PAUSED_ASSET = "paused";

    function createBrowsingCard(
      details: string,
      state: string,
      url: string,
      assets?: DrpcActivityAssets
    ): DrpcActivityCard {
      return {
        details,
        state: state || "Browsing 9anime",
        statusDisplayType: "details",
        showElapsedTime: true,
        assets: {
          largeImage: LOGO_URL,
          largeText: "9anime",
          largeUrl: url,
          ...(assets || {})
        },
        buttons: [
          {
            label: "Open 9anime",
            url
          }
        ]
      };
    }

    function getAnimeTitle(documentRef: DrpcDocumentLike): string {
      const element = documentRef.querySelector(".film-infor .film-name.dynamic-name") as
        | { textContent?: string | null }
        | null;
      let resolvedTitle = "";

      if (element?.textContent) {
        resolvedTitle = element.textContent.trim();
      } else {
        resolvedTitle = String(documentRef.title || "")
          .replace(/^Watch /i, "")
          .replace(/ online free on 9anime$/i, "")
          .trim();
      }

      return resolvedTitle ? `Watching: ${resolvedTitle}` : "";
    }

    function getEpisodeLabel(documentRef: DrpcDocumentLike): string {
      const activeEpisode = documentRef.querySelector(".ep-item.active") as
        | {
            textContent?: string | null;
            dataset?: { number?: string };
            querySelector(selector: string): { textContent?: string | null } | null;
          }
        | null;

      if (!activeEpisode) {
        return "";
      }

      const rawText = String(activeEpisode.textContent || "").replace(/\s+/g, " ").trim();
      if (rawText && !/^ep$/i.test(rawText)) {
        return rawText.startsWith("Episode ") ? rawText : `Episode ${rawText}`;
      }

      const dataNumber = activeEpisode.dataset?.number;
      if (dataNumber) {
        return `Episode ${dataNumber}`;
      }

      const order = activeEpisode.querySelector(".order");
      if (order?.textContent) {
        return `Episode ${order.textContent.trim()}`;
      }

      return "";
    }

    function getCoverArt(documentRef: DrpcDocumentLike): string {
      const image = documentRef.querySelector(".anime-poster img") as { src?: string } | null;
      return image?.src || LOGO_URL;
    }

    function getSearchQuery(search: string): string {
      const params = new URLSearchParams(search || "");
      return params.get("keyword") || params.get("q") || "";
    }

    function getEffectivePlaybackState(context: DrpcSiteContext): DrpcPlaybackState {
      if (context.embeddedPlayback) {
        return context.embeddedPlayback.paused ? "paused" : "playing";
      }

      return context.playbackState;
    }

    function getEffectivePlaybackTimestamps(context: DrpcSiteContext): DrpcPlaybackTimestamps {
      if (!context.embeddedPlayback) {
        return context.playbackTimestamps;
      }

      return {
        startedAtUnixSeconds: context.embeddedPlayback.startedAtUnixSeconds,
        endAtUnixSeconds: context.embeddedPlayback.endAtUnixSeconds
      };
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
            activityCard: createBrowsingCard(
              "Viewing Homepage",
              "Browsing 9anime",
              context.location.href
            )
          };
        }

        if (pathname === "/search") {
          const query = getSearchQuery(context.location.search).replace(/\+/g, " ").trim();
          if (!query) {
            return null;
          }
          return {
            pageTitle: `Search: ${query}`,
            activityCard: createBrowsingCard(
              `Viewing results: ${query}`,
              "Searching 9anime",
              context.location.href
            )
          };
        }

        if (pathname.includes("/genre/")) {
          const genre = pathname.split("/")[2] || "";
          if (!genre) {
            return null;
          }
          return {
            pageTitle: `Genre: ${genre}`,
            activityCard: createBrowsingCard(
              `Viewing genre: ${genre}`,
              "Browsing 9anime",
              context.location.href
            )
          };
        }

        if (pathname.includes("/watch/")) {
          const title = getAnimeTitle(context.document);
          if (!title) {
            return null;
          }

          const episodeLabel = getEpisodeLabel(context.document);
          const coverArt = getCoverArt(context.document);
          const playbackState = getEffectivePlaybackState(context);
          const playbackTimestamps = getEffectivePlaybackTimestamps(context);
          const playing = playbackState === "playing";

          return {
            pageTitle: title,
            playbackState,
            activityCard: {
              name: title,
              details: title,
              state: episodeLabel || "Watching on 9anime",
              type: "listening",
              statusDisplayType: "details",
              showElapsedTime: Boolean(playing && playbackTimestamps.startedAtUnixSeconds),
              startedAtUnixSeconds: playing
                ? playbackTimestamps.startedAtUnixSeconds ?? null
                : null,
              endAtUnixSeconds: playing ? playbackTimestamps.endAtUnixSeconds ?? null : null,
              assets: {
                largeImage: coverArt,
                largeText: episodeLabel || "9anime",
                largeUrl: context.location.href,
                smallImage: playing ? PLAYING_ASSET : PAUSED_ASSET,
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

        if (
          pathname === "/movie" ||
          pathname === "/tv" ||
          pathname === "/ova" ||
          pathname === "/ona" ||
          pathname === "/special" ||
          pathname === "/recently-updated" ||
          pathname === "/recently-added" ||
          pathname === "/ongoing" ||
          pathname === "/upcoming"
        ) {
          const labels: Record<string, string> = {
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
            activityCard: createBrowsingCard(
              `${labels[pathname]}...`,
              "Browsing 9anime",
              context.location.href
            )
          };
        }

        return null;
      }
    };
  }
);
