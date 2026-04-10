(function(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.DrpcSiteConfig = api;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function() {
    // Edit this file and reload the unpacked extension to enable or disable
    // specific site detectors, or to override the activity card generated for
    // a single site.
    const DEFAULT_CONFIG = {
      crunchyroll: {
        enabled: true,
        settings: {},
        activityOverrides: {}
      },
      hidive: {
        enabled: true,
        settings: {},
        activityOverrides: {}
      },
      "9anime": {
        enabled: true,
        // Example:
        // activityOverrides: {
        //   type: "watching",
        //   state: "Watching anime",
        //   buttons: []
        // },
        settings: {},
        activityOverrides: {}
      }
    };

    let currentConfig = clone(DEFAULT_CONFIG);

    function clone(value) {
      return JSON.parse(JSON.stringify(value || {}));
    }

    function isRecord(value) {
      return value && typeof value === "object" && !Array.isArray(value);
    }

    function normalizePersistedConfig(config) {
      const merged = clone(DEFAULT_CONFIG);

      if (!isRecord(config)) {
        return merged;
      }

      for (const [siteId, rawEntry] of Object.entries(config)) {
        if (!isRecord(rawEntry)) {
          continue;
        }

        const baseEntry = isRecord(merged[siteId]) ? merged[siteId] : {
          enabled: true,
          settings: {},
          activityOverrides: {}
        };
        const activityOverrides = isRecord(rawEntry.activityOverrides)
          ? clone(rawEntry.activityOverrides)
          : {};

        // Legacy popup builds exposed a type override control. The current popup
        // does not, so persisted values here become invisible sticky overrides.
        delete activityOverrides.type;

        merged[siteId] = {
          enabled: rawEntry.enabled !== undefined ? rawEntry.enabled !== false : baseEntry.enabled !== false,
          settings: Object.assign({}, baseEntry.settings || {}, isRecord(rawEntry.settings) ? rawEntry.settings : {}),
          activityOverrides: Object.assign({}, baseEntry.activityOverrides || {}, activityOverrides)
        };
      }

      return merged;
    }

    return {
      getSiteConfig(siteId) {
        return clone(currentConfig[String(siteId || "")] || {});
      },
      getAllSiteConfigs() {
        return clone(currentConfig);
      },
      setConfig(config) {
        currentConfig = normalizePersistedConfig(config);
      },
      reset() {
        currentConfig = clone(DEFAULT_CONFIG);
      }
    };
  }
);
