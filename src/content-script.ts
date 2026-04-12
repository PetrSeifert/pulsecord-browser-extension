(function() {
  const root = globalThis as DrpcGlobalRoot;
  const registry = root.DrpcSiteRegistry;
  const registryApi = root.DrpcSiteRegistryApi;
  const siteConfigApi = root.DrpcSiteConfig;
  const snapshotGateApi = root.DrpcSnapshotGate;
  const FRAME_MEDIA_MESSAGE_TYPE = "drpc-frame-media";
  const EMBEDDED_PLAYBACK_TTL_MS = 30000;
  const PLAYBACK_PROGRESS_SNAPSHOT_INTERVAL_MS = 1000;
  const SNAPSHOT_KEEPALIVE_INTERVAL_MS = 10000;
  const PLAYBACK_TIMESTAMP_DRIFT_TOLERANCE_SECONDS = 2;
  const MEDIA_IMMEDIATE_EVENTS = [
    "play",
    "playing",
    "pause",
    "seeking",
    "seeked",
    "loadedmetadata",
    "durationchange",
    "ended",
    "ratechange"
  ] as const;
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
  let lastSnapshotSentAt = 0;
  let lastTimeUpdateSentAt = 0;
  let lastFramePlaybackSignature = "";
  let latestSnapshotBuildId = 0;
  let embeddedPlayback: DrpcEmbeddedPlayback | null = null;
  let localPlaybackAnchor: {
    sourceKey: string;
    currentTime: number;
    durationSeconds: number;
    playbackRate: number;
    observedAtUnixMs: number;
    startedAtUnixSeconds: number;
  } | null = null;
  let embeddedPlaybackAnchor: {
    sourceKey: string;
    currentTime: number;
    durationSeconds: number;
    playbackRate: number;
    observedAtUnixMs: number;
    startedAtUnixSeconds: number;
  } | null = null;

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
  ): { currentTime: number; duration: number; paused: boolean; playbackRate: number } | null {
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
      paused: media.paused || media.ended,
      playbackRate: Number.isFinite(media.playbackRate) && media.playbackRate > 0 ? media.playbackRate : 1
    };
  }

  function getPlaybackRate(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  function getRateAdjustedTimestamps(
    currentTime: number,
    duration: number,
    _playbackRate: number,
    nowUnixMs: number
  ): DrpcPlaybackTimestamps {
    const currentTimeSeconds = Math.max(0, currentTime);
    const durationSeconds = Math.max(currentTimeSeconds, duration);
    const nowUnixSeconds = nowUnixMs / 1000;
    const startedAtUnixSeconds = Math.floor(nowUnixSeconds - currentTimeSeconds);

    return {
      startedAtUnixSeconds,
      endAtUnixSeconds: Math.ceil(startedAtUnixSeconds + durationSeconds)
    };
  }

  function resolveStablePlaybackTimestamps(
    sample: { currentTime: number; duration: number; paused: boolean; playbackRate: number } | null,
    nowUnixMs: number,
    sourceKey: string,
    previousAnchor: {
      sourceKey: string;
      currentTime: number;
      durationSeconds: number;
      playbackRate: number;
      observedAtUnixMs: number;
      startedAtUnixSeconds: number;
    } | null
  ): {
    timestamps: DrpcPlaybackTimestamps;
    anchor: {
      sourceKey: string;
      currentTime: number;
      durationSeconds: number;
      playbackRate: number;
      observedAtUnixMs: number;
      startedAtUnixSeconds: number;
    } | null;
  } {
    if (!sample || sample.paused) {
      return {
        timestamps: {},
        anchor: null
      };
    }

    const currentTime = Math.max(0, sample.currentTime);
    const durationSeconds = Math.max(currentTime, sample.duration);
    const playbackRate = getPlaybackRate(sample.playbackRate);
    const computedTimestamps = getRateAdjustedTimestamps(currentTime, durationSeconds, playbackRate, nowUnixMs);
    const shouldUseLiveTimestamps = Math.abs(playbackRate - 1) > 0.001;

    let startedAtUnixSeconds = computedTimestamps.startedAtUnixSeconds;
    if (
      !shouldUseLiveTimestamps &&
      previousAnchor &&
      previousAnchor.sourceKey === sourceKey &&
      Math.abs(previousAnchor.durationSeconds - durationSeconds) <= 1 &&
      Math.abs(previousAnchor.playbackRate - playbackRate) <= 0.001
    ) {
      const elapsedWallClockSeconds = Math.max(0, (nowUnixMs - previousAnchor.observedAtUnixMs) / 1000);
      const expectedCurrentTime = previousAnchor.currentTime + elapsedWallClockSeconds * previousAnchor.playbackRate;
      const drift = Math.abs(expectedCurrentTime - currentTime);

      if (drift <= PLAYBACK_TIMESTAMP_DRIFT_TOLERANCE_SECONDS) {
        startedAtUnixSeconds = previousAnchor.startedAtUnixSeconds;
      }
    }

    return {
      timestamps: {
        startedAtUnixSeconds,
        endAtUnixSeconds: computedTimestamps.endAtUnixSeconds
      },
      anchor: {
        sourceKey,
        currentTime,
        durationSeconds,
        playbackRate,
        observedAtUnixMs: nowUnixMs,
        startedAtUnixSeconds: startedAtUnixSeconds ?? (computedTimestamps.startedAtUnixSeconds || 0)
      }
    };
  }

  function getPlaybackTimestamps(
    media: HTMLMediaElement | null,
    nowUnixMs: number
  ): DrpcPlaybackTimestamps {
    const resolved = resolveStablePlaybackTimestamps(
      getPlaybackSample(media),
      nowUnixMs,
      `top:${location.href}`,
      localPlaybackAnchor
    );
    localPlaybackAnchor = resolved.anchor;
    return resolved.timestamps;
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
      playbackTimestamps: getPlaybackTimestamps(media, nowUnixMs),
      embeddedPlayback: getEmbeddedPlayback(nowUnixMs)
    };
  }

  function isActivityResult(result: DrpcCollectActivityValue): result is DrpcSiteActivityResult {
    return Boolean(
      result &&
      typeof result === "object" &&
      ("activityCard" in result || "pageTitle" in result || "playbackState" in result)
    );
  }

  async function buildSnapshot(): Promise<DrpcSnapshotMessage> {
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

    let result: DrpcCollectActivityValue = null;
    try {
      result = await Promise.resolve(context.siteDefinition.collectActivity(context));
    } catch (error) {
      console.warn("[drpc] site adapter failed to collect activity", error);
    }

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
    if (snapshotGateApi) {
      return snapshotGateApi.buildSignature(snapshot);
    }

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

  function shouldSendSnapshot(
    reason: DrpcSnapshotSendReason,
    signature: string,
    nowUnixMs: number
  ): boolean {
    if (snapshotGateApi) {
      return snapshotGateApi.shouldSendSnapshot({
        reason,
        signature,
        lastSignature,
        lastSnapshotSentAt,
        keepaliveIntervalMs: SNAPSHOT_KEEPALIVE_INTERVAL_MS,
        nowUnixMs
      });
    }

    if (signature !== lastSignature) {
      return true;
    }

    if (reason === "init" || reason === "media" || reason === "navigation") {
      return true;
    }

    if (reason === "heartbeat") {
      return nowUnixMs - lastSnapshotSentAt >= SNAPSHOT_KEEPALIVE_INTERVAL_MS;
    }

    return false;
  }

  async function sendSnapshot(reason: DrpcSnapshotSendReason): Promise<void> {
    if (!isTopFrame) {
      return;
    }

    const buildId = ++latestSnapshotBuildId;
    const snapshot = await buildSnapshot();
    if (buildId !== latestSnapshotBuildId) {
      return;
    }

    const signature = buildSignature(snapshot);
    const now = Date.now();

    if (!shouldSendSnapshot(reason, signature, now)) {
      return;
    }

    lastSignature = signature;
    lastSnapshotSentAt = now;
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
    embeddedPlaybackAnchor = null;
    void sendSnapshot("media");
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
          playbackRate: sample.playbackRate,
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
            paused: sample.paused,
            playbackRate: sample.playbackRate
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
    const playbackRate = getPlaybackRate(Number(data["playbackRate"]));
    const nowUnixMs = Date.now();
    const sample = {
      currentTime: Math.max(0, currentTime),
      duration: Math.max(currentTime, duration),
      paused,
      playbackRate
    };
    const resolved = resolveStablePlaybackTimestamps(
      sample,
      nowUnixMs,
      `frame:${sourceUrl || location.href}`,
      embeddedPlaybackAnchor
    );
    embeddedPlaybackAnchor = resolved.anchor;

    embeddedPlayback = {
      currentTime: sample.currentTime,
      duration: sample.duration,
      paused,
      playbackRate,
      startedAtUnixSeconds: resolved.timestamps.startedAtUnixSeconds,
      endAtUnixSeconds: resolved.timestamps.endAtUnixSeconds,
      receivedAtUnixMs: nowUnixMs,
      sourceUrl
    };

    void sendSnapshot("media");
  }

  function attachToMedia(media: HTMLMediaElement | null): void {
    if (!media || media === attachedMedia) {
      return;
    }

    attachedMedia = media;
    lastTimeUpdateSentAt = 0;
    localPlaybackAnchor = null;
    const sendImmediate = (): void => {
      if (isTopFrame) {
        void sendSnapshot("media");
        return;
      }

      postFramePlayback(true);
    };
    const sendTimeUpdate = (): void => {
      const now = Date.now();
      if (now - lastTimeUpdateSentAt >= PLAYBACK_PROGRESS_SNAPSHOT_INTERVAL_MS) {
        lastTimeUpdateSentAt = now;
        if (isTopFrame) {
          void sendSnapshot("timeupdate");
          return;
        }

        postFramePlayback(false);
      }
    };

    MEDIA_IMMEDIATE_EVENTS.forEach((eventName) => {
      media.addEventListener(eventName, sendImmediate);
    });
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
      embeddedPlaybackAnchor = null;
      setTimeout(() => void sendSnapshot("navigation"), 0);
      return result;
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function(...args) {
      const result = originalReplaceState.apply(this, args);
      embeddedPlayback = null;
      embeddedPlaybackAnchor = null;
      setTimeout(() => void sendSnapshot("navigation"), 0);
      return result;
    };

    addEventListener("popstate", () => {
      embeddedPlayback = null;
      embeddedPlaybackAnchor = null;
      void sendSnapshot("navigation");
    });
    addEventListener("hashchange", () => {
      embeddedPlayback = null;
      embeddedPlaybackAnchor = null;
      void sendSnapshot("navigation");
    });
  }

  if (isTopFrame) {
    window.addEventListener("message", handleEmbeddedPlaybackMessage);
    chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
      if (message?.type === "collectSnapshot") {
        void buildSnapshot().then((snapshot) => {
          sendResponse({ snapshot });
        });
        return true;
      }
    });
  }

  const observer = new MutationObserver(() => {
    discoverMedia();
    if (isTopFrame) {
      void sendSnapshot("mutation");
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
    void sendSnapshot("init");
    setInterval(() => {
      void sendSnapshot("heartbeat");
    }, SNAPSHOT_KEEPALIVE_INTERVAL_MS);
  } else {
    postFramePlayback(true);
    setInterval(() => {
      discoverMedia();
      postFramePlayback(false);
    }, 1000);
  }
})();
