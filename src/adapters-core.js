(function(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.DrpcBrowserAdapters = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  const SITE_NAMES = {
    crunchyroll: "Crunchyroll",
    hidive: "HIDIVE"
  };

  function normalizeHost(hostname) {
    return String(hostname || "").toLowerCase();
  }

  function detectSite(hostname) {
    const normalized = normalizeHost(hostname);
    if (normalized.includes("crunchyroll.com")) {
      return "crunchyroll";
    }
    if (normalized.includes("hidive.com")) {
      return "hidive";
    }
    return "";
  }

  function cleanTitle(title, suffixes) {
    return suffixes.reduce((value, suffix) => value.replace(suffix, ""), String(title || "")).trim();
  }

  function splitEpisodeTitle(value) {
    const cleaned = String(value || "").trim();
    if (!cleaned) {
      return { seriesTitle: "", episodeLabel: "" };
    }

    const parts = cleaned.split(" - ").map(part => part.trim()).filter(Boolean);
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

  function extractMetadata(input) {
    const siteId = detectSite(input.hostname);
    const metas = input.metas || {};
    const rawTitle = metas["og:title"] || metas["twitter:title"] || input.title || "";

    if (siteId === "crunchyroll") {
      const pageTitle = cleanTitle(rawTitle, [
        /\s*-\s*Watch on Crunchyroll$/i,
        /\s*-\s*Crunchyroll$/i
      ]);
      const split = splitEpisodeTitle(pageTitle);
      return {
        siteId,
        siteName: SITE_NAMES[siteId],
        pageTitle,
        seriesTitle: split.seriesTitle,
        episodeLabel: split.episodeLabel
      };
    }

    if (siteId === "hidive") {
      const pageTitle = cleanTitle(rawTitle, [
        /\s*-\s*Watch HIDIVE$/i,
        /\s*-\s*HIDIVE$/i
      ]);
      const split = splitEpisodeTitle(pageTitle);
      return {
        siteId,
        siteName: SITE_NAMES[siteId],
        pageTitle,
        seriesTitle: split.seriesTitle,
        episodeLabel: split.episodeLabel
      };
    }

    return {
      siteId,
      siteName: SITE_NAMES[siteId] || "",
      pageTitle: String(input.title || "").trim(),
      seriesTitle: "",
      episodeLabel: ""
    };
  }

  return {
    SITE_NAMES,
    detectSite,
    extractMetadata
  };
});
