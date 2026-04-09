(function(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.DrpcSiteRegistryApi = api;
  if (!root.DrpcSiteRegistry) {
    root.DrpcSiteRegistry = api.createRegistry();
  }
})(
  globalThis as DrpcGlobalRoot,
  function(): DrpcSiteRegistryApi {
    const STATUS_DISPLAY_TYPES: DrpcStatusDisplayType[] = ["name", "details", "state"];

    function wildcardToRegex(value: string): string {
      return String(value || "")
        .split("*")
        .map((segment) => segment.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"))
        .join(".*");
    }

    function matchesPattern(url: string, pattern: string): boolean {
      try {
        const parsedUrl = new URL(String(url || ""));
        const parts = String(pattern || "").split("://");
        if (parts.length !== 2) {
          return false;
        }

        const schemePattern = parts[0];
        if (schemePattern !== "*" && parsedUrl.protocol !== `${schemePattern}:`) {
          return false;
        }

        const slashIndex = parts[1].indexOf("/");
        const hostPattern = slashIndex >= 0 ? parts[1].slice(0, slashIndex) : parts[1];
        const pathPattern = slashIndex >= 0 ? parts[1].slice(slashIndex) : "/*";

        const hostname = parsedUrl.hostname.toLowerCase();
        const normalizedHostPattern = hostPattern.toLowerCase();
        let hostMatches = false;
        if (normalizedHostPattern === "*") {
          hostMatches = true;
        } else if (normalizedHostPattern.startsWith("*.")) {
          const baseHost = normalizedHostPattern.slice(2);
          hostMatches = hostname === baseHost || hostname.endsWith(`.${baseHost}`);
        } else {
          hostMatches = hostname === normalizedHostPattern;
        }

        if (!hostMatches) {
          return false;
        }

        const pathRegex = new RegExp(`^${wildcardToRegex(pathPattern)}$`, "i");
        return pathRegex.test(parsedUrl.pathname);
      } catch {
        return false;
      }
    }

    function sanitizeString(value: unknown): string {
      return typeof value === "string" ? value.trim() : "";
    }

    function sanitizeButtons(buttons: DrpcActivityButton[] | undefined): DrpcActivityButton[] {
      if (!Array.isArray(buttons)) {
        return [];
      }

      return buttons
        .map((button) => ({
          label: sanitizeString(button?.label),
          url: sanitizeString(button?.url)
        }))
        .filter((button) => button.label && button.url)
        .slice(0, 2);
    }

    function sanitizeAssets(assets: DrpcActivityAssets | undefined): DrpcActivityAssets {
      return {
        largeImage: sanitizeString(assets?.largeImage),
        largeText: sanitizeString(assets?.largeText),
        largeUrl: sanitizeString(assets?.largeUrl),
        smallImage: sanitizeString(assets?.smallImage),
        smallText: sanitizeString(assets?.smallText),
        smallUrl: sanitizeString(assets?.smallUrl)
      };
    }

    function sanitizeTimestamp(value: unknown): number | null {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return null;
      }

      return Math.trunc(value);
    }

    function sanitizeActivityCard(card: DrpcActivityCard | null | undefined): DrpcActivityCard | null {
      if (!card || typeof card !== "object") {
        return null;
      }

      const statusDisplayType = STATUS_DISPLAY_TYPES.includes(card.statusDisplayType || "name")
        ? (card.statusDisplayType as DrpcStatusDisplayType)
        : "name";

      const normalized: DrpcActivityCard = {
        name: sanitizeString(card.name),
        details: sanitizeString(card.details),
        detailsUrl: sanitizeString(card.detailsUrl),
        state: sanitizeString(card.state),
        stateUrl: sanitizeString(card.stateUrl),
        statusDisplayType,
        showElapsedTime: card.showElapsedTime !== false,
        assets: sanitizeAssets(card.assets),
        buttons: sanitizeButtons(card.buttons)
      };

      const startedAtUnixSeconds = sanitizeTimestamp(card.startedAtUnixSeconds);
      const endAtUnixSeconds = sanitizeTimestamp(card.endAtUnixSeconds);
      if (startedAtUnixSeconds !== null) {
        normalized.startedAtUnixSeconds = startedAtUnixSeconds;
      }
      if (endAtUnixSeconds !== null) {
        normalized.endAtUnixSeconds = endAtUnixSeconds;
      }

      return normalized;
    }

    function createRegistry(): DrpcSiteRegistryRuntime {
      const sites: DrpcSiteDefinition[] = [];

      return {
        registerSite(site) {
          if (!site?.metadata?.id || !Array.isArray(site.metadata.matches)) {
            throw new Error("Invalid site definition.");
          }
          sites.push(site);
        },
        getSites() {
          return sites.slice();
        },
        findSiteForUrl(url) {
          return sites.find((site) =>
            site.metadata.matches.some((pattern) => matchesPattern(url, pattern))
          ) || null;
        }
      };
    }

    return {
      createRegistry,
      matchesPattern,
      sanitizeActivityCard
    };
  }
);
