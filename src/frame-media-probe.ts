(function() {
  if (window.top === window) {
    return;
  }

  const FRAME_MEDIA_MESSAGE_TYPE = "drpc-frame-media";
  const mediaEvents = [
    "play",
    "playing",
    "pause",
    "timeupdate",
    "seeking",
    "seeked",
    "loadedmetadata",
    "durationchange",
    "ended",
    "ratechange"
  ] as const;

  let currentMedia: HTMLMediaElement | null = null;
  let lastPayload = "";

  function getMedia(): HTMLMediaElement | null {
    return document.querySelector("video, audio");
  }

  function buildPayload() {
    const media = currentMedia ?? getMedia();
    if (!media || !Number.isFinite(media.duration) || media.duration <= 0 || !Number.isFinite(media.currentTime)) {
      return null;
    }

    return {
      type: FRAME_MEDIA_MESSAGE_TYPE,
      href: location.href,
      currentTime: Math.max(0, media.currentTime),
      duration: Math.max(media.currentTime, media.duration),
      paused: media.paused || media.ended,
      playbackRate:
        Number.isFinite(media.playbackRate) && media.playbackRate > 0 ? media.playbackRate : 1
    };
  }

  function postVideoData(force = false): void {
    const payload = buildPayload();
    const payloadKey = payload
      ? JSON.stringify({
          href: payload.href,
          currentTime: Math.floor(payload.currentTime),
          duration: Math.floor(payload.duration),
          paused: payload.paused,
          playbackRate: payload.playbackRate
        })
      : JSON.stringify({
          href: location.href,
          clear: true
        });

    if (!force && payloadKey === lastPayload) {
      return;
    }

    lastPayload = payloadKey;
    window.parent.postMessage(
      payload || {
        type: FRAME_MEDIA_MESSAGE_TYPE,
        href: location.href,
        clear: true
      },
      "*"
    );
  }

  function onMediaEvent(): void {
    postVideoData(true);
  }

  function removeMediaListeners(media: HTMLMediaElement): void {
    for (const eventName of mediaEvents) {
      media.removeEventListener(eventName, onMediaEvent);
    }
  }

  function addMediaListeners(media: HTMLMediaElement): void {
    for (const eventName of mediaEvents) {
      media.addEventListener(eventName, onMediaEvent);
    }
  }

  function syncMedia(): void {
    const media = getMedia();
    if (media === currentMedia) {
      return;
    }

    if (currentMedia) {
      removeMediaListeners(currentMedia);
    }

    currentMedia = media;
    lastPayload = "";

    if (currentMedia) {
      addMediaListeners(currentMedia);
    }

    postVideoData(true);
  }

  const observer = new MutationObserver(() => {
    syncMedia();
  });

  if (document.documentElement) {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  syncMedia();
  setInterval(() => {
    syncMedia();
    postVideoData(false);
  }, 1000);
})();
