(function() {
  const root = globalThis as DrpcGlobalRoot;
  const registry = root.DrpcSiteRegistry;
  const registryApi = root.DrpcSiteRegistryApi;
  const siteConfigApi = root.DrpcSiteConfig;
  const FRAME_MEDIA_MESSAGE_TYPE = "drpc-frame-media";
  const EMBEDDED_PLAYBACK_TTL_MS = 30000;
  const isTopFrame = window.top === window;

  // Load persisted site config so user changes apply without page reload.
  if (siteConfigApi) {
    chrome.storage.local.get("drpcSiteConfig", (result) => {
      const saved = result["drpcSiteConfig"];
      if (saved && typeof saved === "object") {
        siteConfigApi.setConfig(saved as Record<string, DrpcSiteConfigEntry>);
      }
    });

    chrome.storage.onChanged.addListener((changes) => {
      if (changes["drpcSiteConfig"]?.newValue && typeof changes["drpcSiteConfig"].newValue === "object") {
        siteConfigApi.setConfig(changes["drpcSiteConfig"].newValue as Record<string, DrpcSiteConfigEntry>);
      }
    });
  }

  let attachedMedia: HTMLMediaElement | null = null;
  let lastSignature = "";
  let lastTimeUpdateSentAt = 0;
  let lastFramePlaybackSignature = "";
  let embeddedPlayback: DrpcEmbeddedPlayback | null = null;

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

  function getPlaybackSample(
    media: HTMLMediaElement | null
  ): { currentTime: number; duration: number; paused: boolean } | null {
    if (
      !media ||
      !Number.isFinite(media.duration) ||
      media.duration <= 0 ||
      !Number.isFinite(media.currentTime)
    ) {
      return null;
    }

    return {
      currentTime: Math.max(0, media.currentTime),
      duration: Math.max(media.currentTime, media.duration),
      paused: media.paused || media.ended
    };
  }

  function getPlaybackTimestampsFromSample(
    sample: { currentTime: number; duration: number } | null,
    nowUnixSeconds: number
  ): DrpcPlaybackTimestamps {
    if (!sample) {
      return {};
    }

    const currentTime = Math.max(0, Math.floor(sample.currentTime));
    const duration = Math.max(currentTime, Math.floor(sample.duration));
    return {
      startedAtUnixSeconds: nowUnixSeconds - currentTime,
      endAtUnixSeconds: nowUnixSeconds + (duration - currentTime)
    };
  }

  function getPlaybackTimestamps(
    media: HTMLMediaElement | null,
    nowUnixSeconds: number
  ): DrpcPlaybackTimestamps {
    const sample = getPlaybackSample(media);
    if (!sample || sample.paused) {
      return {};
    }

    return getPlaybackTimestampsFromSample(sample, nowUnixSeconds);
  }

  function getEmbeddedPlayback(nowUnixMs: number): DrpcEmbeddedPlayback | null {
    if (!embeddedPlayback) {
      return null;
    }

    if (nowUnixMs - embeddedPlayback.receivedAtUnixMs > EMBEDDED_PLAYBACK_TTL_MS) {
      embeddedPlayback = null;
      return null;
    }

    return embeddedPlayback;
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
    const nowUnixMs = Date.now();
    const nowUnixSeconds = Math.floor(nowUnixMs / 1000);

    return {
      siteDefinition,
      siteConfig,
      location,
      document,
      media,
      metaTags: collectMetaTags(),
      nowUnixSeconds,
      playbackState: getPlaybackState(media),
      playbackTimestamps: getPlaybackTimestamps(media, nowUnixSeconds),
      embeddedPlayback: getEmbeddedPlayback(nowUnixMs)
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
      snapshot.activityCard?.type,
      snapshot.activityCard?.startedAtUnixSeconds,
      snapshot.activityCard?.endAtUnixSeconds
    ]);
  }

  function sendSnapshot(reason: "init" | "media" | "mutation" | "navigation" | "timeupdate"): void {
    if (!isTopFrame) {
      return;
    }

    const snapshot = buildSnapshot();
    const signature = buildSignature(snapshot);

    if (reason !== "timeupdate" && signature === lastSignature) {
      return;
    }

    lastSignature = signature;
    console.log("[drpc] outgoing snapshot", snapshot);
    chrome.runtime.sendMessage({ type: "snapshot", snapshot }, () => {
      void chrome.runtime.lastError;
    });
  }

  function clearEmbeddedPlayback(sourceUrl?: string): void {
    if (!embeddedPlayback) {
      return;
    }

    if (sourceUrl && embeddedPlayback.sourceUrl && embeddedPlayback.sourceUrl !== sourceUrl) {
      return;
    }

    embeddedPlayback = null;
    sendSnapshot("media");
  }

  function postFramePlayback(force = false): void {
    if (isTopFrame) {
      return;
    }

    const sample = getPlaybackSample(getMediaElement());
    const signature = sample
      ? JSON.stringify({
          currentTime: Math.floor(sample.currentTime),
          duration: Math.floor(sample.duration),
          paused: sample.paused,
          href: location.href
        })
      : JSON.stringify({ clear: true, href: location.href });

    if (!force && signature === lastFramePlaybackSignature) {
      return;
    }

    lastFramePlaybackSignature = signature;
    window.parent.postMessage(
      sample
        ? {
            type: FRAME_MEDIA_MESSAGE_TYPE,
            href: location.href,
            currentTime: sample.currentTime,
            duration: sample.duration,
            paused: sample.paused
          }
        : {
            type: FRAME_MEDIA_MESSAGE_TYPE,
            href: location.href,
            clear: true
          },
      "*"
    );
  }

  function handleEmbeddedPlaybackMessage(event: MessageEvent): void {
    if (!isTopFrame || event.source === window) {
      return;
    }

    const data = event.data;
    if (!data || typeof data !== "object" || data["type"] !== FRAME_MEDIA_MESSAGE_TYPE) {
      return;
    }

    const sourceUrl = typeof data["href"] === "string" ? data["href"] : undefined;
    if (data["clear"] === true) {
      clearEmbeddedPlayback(sourceUrl);
      return;
    }

    const currentTime = Number(data["currentTime"]);
    const duration = Number(data["duration"]);
    if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0) {
      return;
    }

    const paused = Boolean(data["paused"]);
    const nowUnixMs = Date.now();
    const timestamps = paused
      ? {}
      : getPlaybackTimestampsFromSample(
          {
            currentTime: Math.max(0, currentTime),
            duration: Math.max(currentTime, duration)
          },
          Math.floor(nowUnixMs / 1000)
        );

    embeddedPlayback = {
      currentTime: Math.max(0, currentTime),
      duration: Math.max(currentTime, duration),
      paused,
      startedAtUnixSeconds: timestamps.startedAtUnixSeconds,
      endAtUnixSeconds: timestamps.endAtUnixSeconds,
      receivedAtUnixMs: nowUnixMs,
      sourceUrl
    };

    sendSnapshot("media");
  }

  function attachToMedia(media: HTMLMediaElement | null): void {
    if (!media || media === attachedMedia) {
      return;
    }

    attachedMedia = media;
    const sendImmediate = (): void => {
      if (isTopFrame) {
        sendSnapshot("media");
        return;
      }

      postFramePlayback(true);
    };
    const sendTimeUpdate = (): void => {
      const now = Date.now();
      if (now - lastTimeUpdateSentAt >= 15000) {
        lastTimeUpdateSentAt = now;
        if (isTopFrame) {
          sendSnapshot("timeupdate");
          return;
        }

        postFramePlayback(false);
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
      embeddedPlayback = null;
      setTimeout(() => sendSnapshot("navigation"), 0);
      return result;
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function(...args) {
      const result = originalReplaceState.apply(this, args);
      embeddedPlayback = null;
      setTimeout(() => sendSnapshot("navigation"), 0);
      return result;
    };

    addEventListener("popstate", () => {
      embeddedPlayback = null;
      sendSnapshot("navigation");
    });
    addEventListener("hashchange", () => {
      embeddedPlayback = null;
      sendSnapshot("navigation");
    });
  }

  if (isTopFrame) {
    window.addEventListener("message", handleEmbeddedPlaybackMessage);
    chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
      if (message?.type === "collectSnapshot") {
        sendResponse({ snapshot: buildSnapshot() });
      }
    });
  }

  const observer = new MutationObserver(() => {
    discoverMedia();
    if (isTopFrame) {
      sendSnapshot("mutation");
      return;
    }

    postFramePlayback(false);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  hookHistoryEvents();
  discoverMedia();

  if (isTopFrame) {
    sendSnapshot("init");
  } else {
    postFramePlayback(true);
    setInterval(() => {
      discoverMedia();
      postFramePlayback(false);
    }, 1000);
  }
})();
