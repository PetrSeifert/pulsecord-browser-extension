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
    const LOGO_URL = "https://static.crunchyroll.com/favicons/favicon-32x32.png";

    function cleanTitle(title: string): string {
      return String(title || "")
        .replace(/\s*-\s*Watch on Crunchyroll$/i, "")
        .replace(/\s*-\s*Crunchyroll$/i, "")
        .trim();
    }

    function splitEpisodeTitle(value: string): { seriesTitle: string; episodeLabel: string } {
      const cleaned = cleanTitle(value);
      if (!cleaned) {
        return { seriesTitle: "", episodeLabel: "" };
      }

      const parts = cleaned.split(" - ").map((part) => part.trim()).filter(Boolean);
      if (parts.length >= 2 && /episode|ep\.?|season|ova|special/i.test(parts[1])) {
        return {
          seriesTitle: parts[0],
          episodeLabel: parts.slice(1).join(" - ")
        };
      }

      return {
        seriesTitle: cleaned,
        episodeLabel: ""
      };
    }

    return {
      metadata: {
        id: "crunchyroll",
        name: "Crunchyroll",
        matches: ["https://*.crunchyroll.com/*"]
      },
      collectActivity(context) {
        if (!context.media && !context.location.pathname.includes("/watch/")) {
          return null;
        }

        const rawTitle =
          context.metaTags["og:title"] ||
          context.metaTags["twitter:title"] ||
          context.document.title ||
          "";
        const split = splitEpisodeTitle(rawTitle);
        const timestamps = context.playbackTimestamps;
        const playing = context.playbackState === "playing";

        return {
          pageTitle: split.seriesTitle || cleanTitle(rawTitle) || context.document.title,
          activityCard: {
            name: split.seriesTitle || "Crunchyroll",
            details: split.seriesTitle || cleanTitle(rawTitle) || context.document.title,
            state: split.episodeLabel || "Watching on Crunchyroll",
            type: "watching",
            statusDisplayType: "details",
            showElapsedTime: Boolean(playing && timestamps.startedAtUnixSeconds),
            startedAtUnixSeconds: playing ? timestamps.startedAtUnixSeconds ?? null : null,
            endAtUnixSeconds: playing ? timestamps.endAtUnixSeconds ?? null : null,
            assets: {
              largeImage: context.metaTags["og:image"] || LOGO_URL,
              largeText: split.episodeLabel || "Crunchyroll",
              largeUrl: context.location.href
            },
            buttons: [
              {
                label: "Open Crunchyroll",
                url: context.location.href
              }
            ]
          }
        };
      }
    };
  }
);
