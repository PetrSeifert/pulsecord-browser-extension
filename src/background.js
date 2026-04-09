const HOST_NAME = "com.drpc.browser_host";
const HEARTBEAT_ALARM = "drpc-heartbeat";
const NO_ACTIVE_TAB_SITE_ID = "drpc-no-active-tab";
const INTERNAL_PAGE_SITE_ID = "drpc-internal-page";

let nativePort = null;

async function updateStatus(status, details = {}) {
  const payload = {
    status,
    details,
    updatedAt: Date.now()
  };

  try {
    await chrome.storage.local.set({ drpcStatus: payload });
  } catch (error) {
    console.warn("Failed to persist drpc status:", error);
  }

  const badgeText = status === "ok" ? "OK" : status === "wait" ? "..." : "ERR";
  const badgeColor = status === "ok" ? "#1f8f47" : status === "wait" ? "#6b7280" : "#b42318";
  chrome.action.setBadgeText({ text: badgeText });
  chrome.action.setBadgeBackgroundColor({ color: badgeColor });
}

function detectBrowserName() {
  const userAgent = navigator.userAgent || "";
  if (userAgent.includes("Edg/")) {
    return "edge";
  }
  if (userAgent.includes("OPR/")) {
    return "opera";
  }
  return "chrome";
}

function ensureNativePort() {
  if (nativePort) {
    return nativePort;
  }

  try {
    nativePort = chrome.runtime.connectNative(HOST_NAME);
    void updateStatus("wait", { message: "Connected to native host. Waiting for activity." });
  } catch (error) {
    void updateStatus("error", { message: `connectNative failed: ${error.message}` });
    throw error;
  }

  nativePort.onMessage.addListener(() => {});
  nativePort.onDisconnect.addListener(() => {
    if (chrome.runtime.lastError) {
      console.warn("drpc native port disconnected:", chrome.runtime.lastError.message);
      void updateStatus("error", { message: chrome.runtime.lastError.message });
    } else {
      void updateStatus("error", { message: "Native host disconnected." });
    }
    nativePort = null;
  });
  return nativePort;
}

function normalizeSnapshot(snapshot, tab) {
  if (!snapshot) {
    return null;
  }

  const url = snapshot.url || tab.url || "";
  let host = snapshot.host || "";
  try {
    host = host || new URL(url).host;
  } catch (error) {
    host = host || "";
  }

  return {
    schemaVersion: 1,
    browser: detectBrowserName(),
    tabId: tab.id ?? null,
    url,
    host,
    pageTitle: snapshot.pageTitle || tab.title || "",
    siteId: snapshot.siteId || "",
    playbackState: snapshot.playbackState || (tab.audible ? "playing" : "idle"),
    seriesTitle: snapshot.seriesTitle || "",
    episodeLabel: snapshot.episodeLabel || "",
    positionSeconds: snapshot.positionSeconds ?? null,
    durationSeconds: snapshot.durationSeconds ?? null,
    sentAtUnixMs: Date.now()
  };
}

function classifyTab(tab) {
  if (!tab) {
    return "none";
  }

  const url = tab.url || "";
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return "web";
  }

  return "internal";
}

function buildBrowserStateSnapshot({ pageTitle, siteId, url = "", host = "", tabId = null }) {
  return {
    schemaVersion: 1,
    browser: detectBrowserName(),
    tabId,
    url,
    host,
    pageTitle,
    siteId,
    playbackState: "idle",
    seriesTitle: "",
    episodeLabel: "",
    positionSeconds: null,
    durationSeconds: null,
    sentAtUnixMs: Date.now()
  };
}

function buildNoActiveTabSnapshot() {
  return buildBrowserStateSnapshot({
    pageTitle: "No active browser tab",
    siteId: NO_ACTIVE_TAB_SITE_ID
  });
}

function buildInternalPageSnapshot(tab) {
  let host = "";
  try {
    const parsed = new URL(tab.url || "");
    host = parsed.host || parsed.protocol.replace(/:$/, "");
  } catch (error) {
    host = "";
  }

  return buildBrowserStateSnapshot({
    pageTitle: tab?.title || "Unsupported browser page",
    siteId: INTERNAL_PAGE_SITE_ID,
    url: tab?.url || "",
    host,
    tabId: tab?.id ?? null
  });
}

function buildGenericSnapshot(tab) {
  return normalizeSnapshot({
    pageTitle: tab.title || "",
    playbackState: tab.audible ? "playing" : "idle"
  }, tab);
}

function postSnapshot(snapshot, messageOverride = null) {
  if (!snapshot) {
    return;
  }

  try {
    ensureNativePort().postMessage(snapshot);
    void updateStatus("ok", {
      message: messageOverride || "Snapshot forwarded to native host.",
      host: snapshot.host,
      pageTitle: snapshot.pageTitle,
      playbackState: snapshot.playbackState
    });
  } catch (error) {
    nativePort = null;
    console.warn("Failed to post drpc snapshot:", error);
    void updateStatus("error", { message: `postMessage failed: ${error.message}` });
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });
  return tabs[0] || null;
}

async function requestSnapshotFromTab(tab) {
  if (!tab?.id || !tab.url || !tab.url.startsWith("http")) {
    return null;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "collectSnapshot" });
    if (response?.snapshot) {
      return normalizeSnapshot(response.snapshot, tab);
    }
  } catch (error) {
    // No content script available for this tab.
  }

  return buildGenericSnapshot(tab);
}

async function collectAndSendActiveTab() {
  const tab = await getActiveTab();
  const tabType = classifyTab(tab);

  if (tabType === "none") {
    postSnapshot(buildNoActiveTabSnapshot(), "No active browser tab.");
    return;
  }

  if (tabType === "internal") {
    postSnapshot(buildInternalPageSnapshot(tab), "Active tab is a browser page that extensions cannot inspect.");
    return;
  }

  const snapshot = await requestSnapshotFromTab(tab);
  postSnapshot(snapshot);
}

chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
  void updateStatus("wait", { message: "Extension installed. Waiting for active tab scan." });
  void collectAndSendActiveTab();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) {
    void collectAndSendActiveTab();
  }
});

chrome.tabs.onActivated.addListener(() => {
  void collectAndSendActiveTab();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.status === "complete" || changeInfo.url)) {
    void collectAndSendActiveTab();
  }
});

chrome.windows.onFocusChanged.addListener(() => {
  void collectAndSendActiveTab();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
  void updateStatus("wait", { message: "Browser startup detected. Waiting for active tab scan." });
  void collectAndSendActiveTab();
});

chrome.action.onClicked.addListener(() => {
  void collectAndSendActiveTab();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "snapshot" || !sender.tab) {
    return;
  }

  const snapshot = normalizeSnapshot(message.snapshot, sender.tab);
  if (sender.tab.active) {
    postSnapshot(snapshot);
  }
  sendResponse({ ok: true });
});
