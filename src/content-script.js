(function() {
  const adapters = globalThis.DrpcBrowserAdapters;
  let attachedVideo = null;
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

  function getPlaybackState(video) {
    if (!video) {
      return "idle";
    }
    if (video.paused || video.ended) {
      return "paused";
    }
    return "playing";
  }

  function buildSnapshot() {
    const video = document.querySelector("video");
    const metadata = adapters.extractMetadata({
      hostname: location.hostname,
      title: document.title,
      pathname: location.pathname,
      metas: collectMetaTags()
    });

    return {
      schemaVersion: 1,
      url: location.href,
      host: location.host,
      pageTitle: metadata.pageTitle || document.title || "",
      siteId: metadata.siteId || "",
      playbackState: getPlaybackState(video),
      seriesTitle: metadata.seriesTitle || "",
      episodeLabel: metadata.episodeLabel || "",
      positionSeconds: video && Number.isFinite(video.currentTime) ? Math.round(video.currentTime) : null,
      durationSeconds: video && Number.isFinite(video.duration) ? Math.round(video.duration) : null,
      sentAtUnixMs: Date.now()
    };
  }

  function sendSnapshot(reason) {
    const snapshot = buildSnapshot();
    const signature = JSON.stringify([
      snapshot.url,
      snapshot.playbackState,
      snapshot.seriesTitle,
      snapshot.episodeLabel,
      snapshot.positionSeconds
    ]);

    if (reason !== "timeupdate" && signature === lastSignature) {
      return;
    }

    lastSignature = signature;
    chrome.runtime.sendMessage({ type: "snapshot", snapshot }, () => {
      void chrome.runtime.lastError;
    });
  }

  function attachToVideo(video) {
    if (!video || video === attachedVideo) {
      return;
    }

    attachedVideo = video;
    const sendImmediate = () => sendSnapshot("video");
    const sendTimeUpdate = () => {
      const now = Date.now();
      if (now - lastTimeUpdateSentAt >= 15000) {
        lastTimeUpdateSentAt = now;
        sendSnapshot("timeupdate");
      }
    };

    ["play", "pause", "seeking", "seeked", "loadedmetadata", "ended", "ratechange"].forEach((eventName) => {
      video.addEventListener(eventName, sendImmediate);
    });
    video.addEventListener("timeupdate", sendTimeUpdate);
  }

  function discoverVideo() {
    attachToVideo(document.querySelector("video"));
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "collectSnapshot") {
      sendResponse({ snapshot: buildSnapshot() });
    }
  });

  const observer = new MutationObserver(() => {
    discoverVideo();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  discoverVideo();
  sendSnapshot("init");
})();
