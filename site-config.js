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

    return {
      getSiteConfig(siteId) {
        return clone(currentConfig[String(siteId || "")] || {});
      },
      getAllSiteConfigs() {
        return clone(currentConfig);
      },
      setConfig(config) {
        currentConfig = clone(config);
      },
      reset() {
        currentConfig = clone(DEFAULT_CONFIG);
      }
    };
  }
);
