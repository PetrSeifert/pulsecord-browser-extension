(function(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.DrpcSnapshotGate = api;
})(
  globalThis as DrpcGlobalRoot,
  function(): DrpcSnapshotGateApi {
    function buildSignature(snapshot: DrpcSnapshotMessage): string {
      return JSON.stringify({
        url: snapshot.url,
        host: snapshot.host,
        pageTitle: snapshot.pageTitle,
        siteId: snapshot.siteId,
        playbackState: snapshot.playbackState,
        activityDisposition: snapshot.activityDisposition,
        activityCard: snapshot.activityCard || null
      });
    }

    function shouldSendSnapshot(input: DrpcSnapshotGateInput): boolean {
      const {
        reason,
        signature,
        lastSignature,
        lastSnapshotSentAt,
        keepaliveIntervalMs,
        nowUnixMs
      } = input;

      if (signature !== lastSignature) {
        return true;
      }

      if (reason === "init" || reason === "media" || reason === "navigation") {
        return true;
      }

      if (reason === "heartbeat") {
        return nowUnixMs - lastSnapshotSentAt >= keepaliveIntervalMs;
      }

      return false;
    }

    return {
      buildSignature,
      shouldSendSnapshot
    };
  }
);
