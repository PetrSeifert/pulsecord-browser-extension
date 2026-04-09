(function() {
  const root = globalThis as DrpcGlobalRoot;
  const registry = root.DrpcSiteRegistry;
  const registryApi = root.DrpcSiteRegistryApi;

  let attachedMedia: HTMLMediaElement | null = null;
  let lastSignature = "";
  let lastTimeUpdateSentAt = 0;

  function collectMetaTags(): Record<string, string> {
    const entries: Record<string, string> = {};
    for (const element of document.querySelectorAll("meta[property], meta[name]")) {
      const key = element.getAttribute("property") || element.getAttribute("name");
      const value = element.getAttribute("content");
      if (key && value && !(key in entries)) {
        entries[key] = value;
      }
    }
    return entries;
  }

  function getMediaElement(): HTMLMediaElement | null {
    return document.querySelector("video, audio");
  }

  function getPlaybackState(media: HTMLMediaElement | null): DrpcPlaybackState {
    if (!media) {
      return "idle";
    }
    if (media.paused || media.ended) {
      return "paused";
    }
    return "playing";
  }

  function getPlaybackTimestamps(
    media: HTMLMediaElement | null,
    nowUnixSeconds: number
  ): DrpcPlaybackTimestamps {
    if (
      !media ||
      !Number.isFinite(media.duration) ||
      media.duration <= 0 ||
      !Number.isFinite(media.currentTime) ||
      media.paused ||
      media.ended
    ) {
      return {};
    }

    const currentTime = Math.max(0, Math.floor(media.currentTime));
    const duration = Math.max(currentTime, Math.floor(media.duration));
    return {
      startedAtUnixSeconds: nowUnixSeconds - currentTime,
      endAtUnixSeconds: nowUnixSeconds + (duration - currentTime)
    };
  }

  function buildContext(): DrpcSiteContext {
    const media = getMediaElement();
    const siteDefinition = registry ? registry.findSiteForUrl(location.href) : null;
    const siteConfig =
      siteDefinition && registryApi
        ? registryApi.getSiteConfig(siteDefinition.metadata.id)
        : {
            enabled: true,
            settings: {},
            activityOverrides: {}
          };
    const nowUnixSeconds = Math.floor(Date.now() / 1000);

    return {
      siteDefinition,
      siteConfig,
      location,
      document,
      media,
      metaTags: collectMetaTags(),
      nowUnixSeconds,
      playbackState: getPlaybackState(media),
      playbackTimestamps: getPlaybackTimestamps(media, nowUnixSeconds)
    };
  }

  function isActivityResult(
    result: DrpcSiteActivityResult | DrpcActivityCard | null
  ): result is DrpcSiteActivityResult {
    return Boolean(
      result &&
      typeof result === "object" &&
      ("activityCard" in result || "pageTitle" in result || "playbackState" in result)
    );
  }

  function buildSnapshot(): DrpcSnapshotMessage {
    const context = buildContext();
    const pageTitle = String(document.title || "").trim();

    if (!context.siteDefinition) {
      return {
        schemaVersion: 2,
        url: location.href,
        host: location.host,
        pageTitle,
        siteId: "",
        playbackState: context.playbackState,
        activityDisposition: "clear",
        activityCard: null,
        sentAtUnixMs: Date.now()
      };
    }

    const result = context.siteDefinition.collectActivity(context);
    const collectedCard = registryApi
      ? registryApi.sanitizeActivityCard(
          isActivityResult(result) ? (result.activityCard ?? null) : result
        )
      : null;
    const activityCard = registryApi
      ? registryApi.applyActivityOverrides(
          collectedCard,
          context.siteConfig.activityOverrides
        )
      : collectedCard;

    return {
      schemaVersion: 2,
      url: location.href,
      host: location.host,
      pageTitle: String((isActivityResult(result) && result.pageTitle) || pageTitle).trim(),
      siteId: context.siteDefinition.metadata.id,
      playbackState: (isActivityResult(result) && result.playbackState) || context.playbackState,
      activityDisposition: activityCard ? "publish" : "clear",
      activityCard: activityCard || null,
      sentAtUnixMs: Date.now()
    };
  }

  function buildSignature(snapshot: DrpcSnapshotMessage): string {
    return JSON.stringify([
      snapshot.url,
      snapshot.pageTitle,
      snapshot.siteId,
      snapshot.playbackState,
      snapshot.activityDisposition,
      snapshot.activityCard?.name,
      snapshot.activityCard?.details,
      snapshot.activityCard?.state,
      snapshot.activityCard?.startedAtUnixSeconds,
      snapshot.activityCard?.endAtUnixSeconds
    ]);
  }

  function sendSnapshot(reason: "init" | "media" | "mutation" | "navigation" | "timeupdate"): void {
    const snapshot = buildSnapshot();
    const signature = buildSignature(snapshot);

    if (reason !== "timeupdate" && signature === lastSignature) {
      return;
    }

    lastSignature = signature;
    chrome.runtime.sendMessage({ type: "snapshot", snapshot }, () => {
      void chrome.runtime.lastError;
    });
  }

  function attachToMedia(media: HTMLMediaElement | null): void {
    if (!media || media === attachedMedia) {
      return;
    }

    attachedMedia = media;
    const sendImmediate = (): void => sendSnapshot("media");
    const sendTimeUpdate = (): void => {
      const now = Date.now();
      if (now - lastTimeUpdateSentAt >= 15000) {
        lastTimeUpdateSentAt = now;
        sendSnapshot("timeupdate");
      }
    };

    ["play", "pause", "seeking", "seeked", "loadedmetadata", "ended", "ratechange"].forEach(
      (eventName) => {
        media.addEventListener(eventName, sendImmediate);
      }
    );
    media.addEventListener("timeupdate", sendTimeUpdate);
  }

  function discoverMedia(): void {
    attachToMedia(getMediaElement());
  }

  function hookHistoryEvents(): void {
    const originalPushState = history.pushState;
    history.pushState = function(...args) {
      const result = originalPushState.apply(this, args);
      setTimeout(() => sendSnapshot("navigation"), 0);
      return result;
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function(...args) {
      const result = originalReplaceState.apply(this, args);
      setTimeout(() => sendSnapshot("navigation"), 0);
      return result;
    };

    addEventListener("popstate", () => sendSnapshot("navigation"));
    addEventListener("hashchange", () => sendSnapshot("navigation"));
  }

  chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
    if (message?.type === "collectSnapshot") {
      sendResponse({ snapshot: buildSnapshot() });
    }
  });

  const observer = new MutationObserver(() => {
    discoverMedia();
    sendSnapshot("mutation");
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  hookHistoryEvents();
  discoverMedia();
  sendSnapshot("init");
})();
