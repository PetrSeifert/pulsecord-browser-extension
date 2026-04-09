(function(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.DrpcBackgroundState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  function cloneSnapshot(snapshot, disposition) {
    const copy = JSON.parse(JSON.stringify(snapshot));
    copy.activityDisposition = disposition || copy.activityDisposition || "sticky";
    copy.sentAtUnixMs = Date.now();
    return copy;
  }

  function upsertCachedSnapshot(cache, snapshot) {
    if (!(cache instanceof Map) || !snapshot || snapshot.tabId == null) {
      return cache;
    }

    cache.set(snapshot.tabId, {
      snapshot: cloneSnapshot(snapshot, "publish"),
      updatedAt: snapshot.sentAtUnixMs || Date.now()
    });
    return cache;
  }

  function removeCachedSnapshot(cache, tabId) {
    if (!(cache instanceof Map)) {
      return cache;
    }

    cache.delete(tabId);
    return cache;
  }

  function selectLatestCachedSnapshot(cache) {
    if (!(cache instanceof Map) || cache.size === 0) {
      return null;
    }

    let selectedEntry = null;
    for (const entry of cache.values()) {
      if (!selectedEntry || entry.updatedAt > selectedEntry.updatedAt) {
        selectedEntry = entry;
      }
    }

    return selectedEntry ? cloneSnapshot(selectedEntry.snapshot, "sticky") : null;
  }

  return {
    cloneSnapshot,
    upsertCachedSnapshot,
    removeCachedSnapshot,
    selectLatestCachedSnapshot
  };
});
