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
    const globalRoot = globalThis as DrpcGlobalRoot;
    const ACTIVITY_TYPES: DrpcActivityType[] = ["playing", "watching"];
    const STATUS_DISPLAY_TYPES: DrpcStatusDisplayType[] = ["name", "details", "state"];
    const DEFAULT_SITE_CONFIG: DrpcResolvedSiteConfig = {
      enabled: true,
      settings: {},
      activityOverrides: {}
    };

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

    function hasOwn(value: object, key: string): boolean {
      return Object.prototype.hasOwnProperty.call(value, key);
    }

    function sanitizeSettings(
      settings: Record<string, DrpcSiteSettingValue> | undefined
    ): Record<string, DrpcSiteSettingValue> {
      if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
        return {};
      }

      const normalized: Record<string, DrpcSiteSettingValue> = {};
      for (const [key, value] of Object.entries(settings)) {
        if (
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean" ||
          value === null
        ) {
          normalized[key] = value;
        }
      }

      return normalized;
    }

    function sanitizeActivityOverrides(
      overrides: DrpcActivityCardOverrides | undefined
    ): DrpcActivityCardOverrides {
      if (!overrides || typeof overrides !== "object") {
        return {};
      }

      const normalized: DrpcActivityCardOverrides = {};
      if (hasOwn(overrides, "name")) {
        normalized.name = sanitizeString(overrides.name);
      }
      if (hasOwn(overrides, "details")) {
        normalized.details = sanitizeString(overrides.details);
      }
      if (hasOwn(overrides, "detailsUrl")) {
        normalized.detailsUrl = sanitizeString(overrides.detailsUrl);
      }
      if (hasOwn(overrides, "state")) {
        normalized.state = sanitizeString(overrides.state);
      }
      if (hasOwn(overrides, "stateUrl")) {
        normalized.stateUrl = sanitizeString(overrides.stateUrl);
      }
      if (
        hasOwn(overrides, "type") &&
        ACTIVITY_TYPES.includes(overrides.type || "playing")
      ) {
        normalized.type = overrides.type;
      }
      if (
        hasOwn(overrides, "statusDisplayType") &&
        STATUS_DISPLAY_TYPES.includes(overrides.statusDisplayType || "name")
      ) {
        normalized.statusDisplayType = overrides.statusDisplayType;
      }
      if (hasOwn(overrides, "showElapsedTime") && typeof overrides.showElapsedTime === "boolean") {
        normalized.showElapsedTime = overrides.showElapsedTime;
      }
      if (hasOwn(overrides, "assets")) {
        normalized.assets = sanitizeAssets(overrides.assets);
      }
      if (hasOwn(overrides, "buttons")) {
        normalized.buttons = sanitizeButtons(overrides.buttons);
      }
      if (hasOwn(overrides, "startedAtUnixSeconds")) {
        normalized.startedAtUnixSeconds = sanitizeTimestamp(overrides.startedAtUnixSeconds);
      }
      if (hasOwn(overrides, "endAtUnixSeconds")) {
        normalized.endAtUnixSeconds = sanitizeTimestamp(overrides.endAtUnixSeconds);
      }

      return normalized;
    }

    function getSiteConfig(siteId: string): DrpcResolvedSiteConfig {
      const configApi = globalRoot.DrpcSiteConfig;
      const configured = configApi?.getSiteConfig(siteId) || {};
      return {
        enabled: configured.enabled !== false,
        settings: sanitizeSettings(configured.settings),
        activityOverrides: sanitizeActivityOverrides(configured.activityOverrides)
      };
    }

    function sanitizeActivityCard(card: DrpcActivityCard | null | undefined): DrpcActivityCard | null {
      if (!card || typeof card !== "object") {
        return null;
      }

      const statusDisplayType = STATUS_DISPLAY_TYPES.includes(card.statusDisplayType || "name")
        ? (card.statusDisplayType as DrpcStatusDisplayType)
        : "name";
      const activityType = ACTIVITY_TYPES.includes(card.type || "playing")
        ? (card.type as DrpcActivityType)
        : "playing";

      const normalized: DrpcActivityCard = {
        name: sanitizeString(card.name),
        details: sanitizeString(card.details),
        detailsUrl: sanitizeString(card.detailsUrl),
        state: sanitizeString(card.state),
        stateUrl: sanitizeString(card.stateUrl),
        type: activityType,
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

    function applyActivityOverrides(
      card: DrpcActivityCard | null | undefined,
      overrides: DrpcActivityCardOverrides | null | undefined
    ): DrpcActivityCard | null {
      const normalizedCard = sanitizeActivityCard(card);
      if (!normalizedCard) {
        return null;
      }

      const normalizedOverrides = sanitizeActivityOverrides(overrides || undefined);
      return {
        name: hasOwn(normalizedOverrides, "name") ? normalizedOverrides.name : normalizedCard.name,
        details: hasOwn(normalizedOverrides, "details")
          ? normalizedOverrides.details
          : normalizedCard.details,
        detailsUrl: hasOwn(normalizedOverrides, "detailsUrl")
          ? normalizedOverrides.detailsUrl
          : normalizedCard.detailsUrl,
        state: hasOwn(normalizedOverrides, "state") ? normalizedOverrides.state : normalizedCard.state,
        stateUrl: hasOwn(normalizedOverrides, "stateUrl")
          ? normalizedOverrides.stateUrl
          : normalizedCard.stateUrl,
        type: hasOwn(normalizedOverrides, "type")
          ? normalizedOverrides.type
          : normalizedCard.type,
        statusDisplayType: hasOwn(normalizedOverrides, "statusDisplayType")
          ? normalizedOverrides.statusDisplayType
          : normalizedCard.statusDisplayType,
        showElapsedTime: hasOwn(normalizedOverrides, "showElapsedTime")
          ? normalizedOverrides.showElapsedTime
          : normalizedCard.showElapsedTime,
        assets: hasOwn(normalizedOverrides, "assets") ? normalizedOverrides.assets : normalizedCard.assets,
        buttons: hasOwn(normalizedOverrides, "buttons") ? normalizedOverrides.buttons : normalizedCard.buttons,
        startedAtUnixSeconds: hasOwn(normalizedOverrides, "startedAtUnixSeconds")
          ? normalizedOverrides.startedAtUnixSeconds
          : normalizedCard.startedAtUnixSeconds,
        endAtUnixSeconds: hasOwn(normalizedOverrides, "endAtUnixSeconds")
          ? normalizedOverrides.endAtUnixSeconds
          : normalizedCard.endAtUnixSeconds
      };
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
            getSiteConfig(site.metadata.id).enabled &&
            site.metadata.matches.some((pattern) => matchesPattern(url, pattern))
          ) || null;
        }
      };
    }

    return {
      createRegistry,
      matchesPattern,
      getSiteConfig(siteId) {
        return siteId ? getSiteConfig(siteId) : DEFAULT_SITE_CONFIG;
      },
      sanitizeActivityCard,
      applyActivityOverrides
    };
  }
);
