(function(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.DrpcBackgroundState = api;
})(
  globalThis as DrpcGlobalRoot,
  function(): DrpcBackgroundStateApi {
    function cloneSnapshot(
      snapshot: DrpcSnapshot,
      disposition?: DrpcActivityDisposition
    ): DrpcSnapshot {
      const copy = JSON.parse(JSON.stringify(snapshot)) as DrpcSnapshot;
      copy.activityDisposition = disposition ?? copy.activityDisposition ?? "sticky";
      copy.sentAtUnixMs = Date.now();
      return copy;
    }

    function upsertCachedSnapshot(
      cache: Map<number, DrpcCachedSnapshotEntry>,
      snapshot: DrpcSnapshot
    ): Map<number, DrpcCachedSnapshotEntry> {
      if (!(cache instanceof Map) || snapshot.tabId == null) {
        return cache;
      }

      cache.set(snapshot.tabId, {
        snapshot: cloneSnapshot(snapshot, "publish"),
        updatedAt: snapshot.sentAtUnixMs || Date.now()
      });
      return cache;
    }

    function removeCachedSnapshot(
      cache: Map<number, DrpcCachedSnapshotEntry>,
      tabId: number
    ): Map<number, DrpcCachedSnapshotEntry> {
      if (!(cache instanceof Map)) {
        return cache;
      }

      cache.delete(tabId);
      return cache;
    }

    function selectLatestCachedSnapshot(
      cache: Map<number, DrpcCachedSnapshotEntry>
    ): DrpcSnapshot | null {
      if (!(cache instanceof Map) || cache.size === 0) {
        return null;
      }

      let selectedEntry: DrpcCachedSnapshotEntry | null = null;
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
  }
);
