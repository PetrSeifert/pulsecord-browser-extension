(function() {
  const registry = globalThis.DrpcSiteRegistry;
  const registryApi = globalThis.DrpcSiteRegistryApi;

  let attachedMedia = null;
  let lastSignature = "";
  let lastTimeUpdateSentAt = 0;

  function collectMetaTags() {
    const entries = {};
    for (const element of document.querySelectorAll("meta[property], meta[name]")) {
      const key = element.getAttribute("property") || element.getAttribute("name");
      const value = element.getAttribute("content");
      if (key && value && !(key in entries)) {
        entries[key] = value;
      }
    }
    return entries;
  }

  function getMediaElement() {
    return document.querySelector("video, audio");
  }

  function getPlaybackState(media) {
    if (!media) {
      return "idle";
    }
    if (media.paused || media.ended) {
      return "paused";
    }
    return "playing";
  }

  function getPlaybackTimestamps(media, nowUnixSeconds) {
    if (!media || !Number.isFinite(media.duration) || media.duration <= 0 || !Number.isFinite(media.currentTime) || media.paused || media.ended) {
      return {};
    }

    const currentTime = Math.max(0, Math.floor(media.currentTime));
    const duration = Math.max(currentTime, Math.floor(media.duration));
    return {
      startedAtUnixSeconds: nowUnixSeconds - currentTime,
      endAtUnixSeconds: nowUnixSeconds + (duration - currentTime)
    };
  }

  function buildContext() {
    const media = getMediaElement();
    const siteDefinition = registry ? registry.findSiteForUrl(location.href) : null;
    const nowUnixSeconds = Math.floor(Date.now() / 1000);

    return {
      siteDefinition,
      location,
      document,
      media,
      metaTags: collectMetaTags(),
      nowUnixSeconds,
      playbackState: getPlaybackState(media),
      playbackTimestamps: getPlaybackTimestamps(media, nowUnixSeconds)
    };
  }

  function buildSnapshot() {
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
    const activityCard = result ? registryApi.sanitizeActivityCard(result.activityCard || result) : null;

    return {
      schemaVersion: 2,
      url: location.href,
      host: location.host,
      pageTitle: String((result && result.pageTitle) || pageTitle).trim(),
      siteId: context.siteDefinition.metadata.id,
      playbackState: (result && result.playbackState) || context.playbackState,
      activityDisposition: activityCard ? "publish" : "clear",
      activityCard: activityCard || null,
      sentAtUnixMs: Date.now()
    };
  }

  function buildSignature(snapshot) {
    return JSON.stringify([
      snapshot.url,
      snapshot.pageTitle,
      snapshot.siteId,
      snapshot.playbackState,
      snapshot.activityDisposition,
      snapshot.activityCard && snapshot.activityCard.name,
      snapshot.activityCard && snapshot.activityCard.details,
      snapshot.activityCard && snapshot.activityCard.state,
      snapshot.activityCard && snapshot.activityCard.startedAtUnixSeconds,
      snapshot.activityCard && snapshot.activityCard.endAtUnixSeconds
    ]);
  }

  function sendSnapshot(reason) {
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

  function attachToMedia(media) {
    if (!media || media === attachedMedia) {
      return;
    }

    attachedMedia = media;
    const sendImmediate = () => sendSnapshot("media");
    const sendTimeUpdate = () => {
      const now = Date.now();
      if (now - lastTimeUpdateSentAt >= 15000) {
        lastTimeUpdateSentAt = now;
        sendSnapshot("timeupdate");
      }
    };

    ["play", "pause", "seeking", "seeked", "loadedmetadata", "ended", "ratechange"].forEach((eventName) => {
      media.addEventListener(eventName, sendImmediate);
    });
    media.addEventListener("timeupdate", sendTimeUpdate);
  }

  function discoverMedia() {
    attachToMedia(getMediaElement());
  }

  function hookHistoryEvents() {
    const wrap = (name) => {
      const original = history[name];
      history[name] = function() {
        const result = original.apply(this, arguments);
        setTimeout(() => sendSnapshot("navigation"), 0);
        return result;
      };
    };

    wrap("pushState");
    wrap("replaceState");
    addEventListener("popstate", () => sendSnapshot("navigation"));
    addEventListener("hashchange", () => sendSnapshot("navigation"));
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
