importScripts(
  "background-state.js",
  "site-registry.js",
  "sites/crunchyroll.js",
  "sites/hidive.js",
  "sites/9anime.js"
);

const HOST_NAME = "com.drpc.browser_host";
const HEARTBEAT_ALARM = "drpc-heartbeat";

const registry = globalThis.DrpcSiteRegistry;
const stateApi = globalThis.DrpcBackgroundState;
const cachedSiteSnapshots = new Map();

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
    void updateStatus("wait", { message: "Connected to native host. Waiting for browser activity." });
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

function isInspectableWebUrl(url) {
  return String(url || "").startsWith("http://") || String(url || "").startsWith("https://");
}

function getSiteDefinitionForUrl(url) {
  if (!registry) {
    return null;
  }

  return registry.findSiteForUrl(url);
}

function buildClearSnapshot(tab, siteId = "") {
  const url = tab?.url || "";
  let host = "";
  try {
    host = new URL(url).host;
  } catch (error) {
    host = "";
  }

  return {
    schemaVersion: 2,
    browser: detectBrowserName(),
    tabId: tab?.id ?? null,
    url,
    host,
    pageTitle: tab?.title || "No matched browser activity",
    siteId,
    playbackState: "idle",
    activityDisposition: "clear",
    activityCard: null,
    sentAtUnixMs: Date.now()
  };
}

function normalizeSnapshot(snapshot, tab, dispositionOverride = null) {
  if (!snapshot) {
    return null;
  }

  const url = snapshot.url || tab?.url || "";
  let host = snapshot.host || "";
  try {
    host = host || new URL(url).host;
  } catch (error) {
    host = host || "";
  }

  return {
    schemaVersion: 2,
    browser: detectBrowserName(),
    tabId: snapshot.tabId ?? tab?.id ?? null,
    url,
    host,
    pageTitle: snapshot.pageTitle || tab?.title || "",
    siteId: snapshot.siteId || "",
    playbackState: snapshot.playbackState || "idle",
    activityDisposition: dispositionOverride || snapshot.activityDisposition || "clear",
    activityCard: snapshot.activityCard || null,
    sentAtUnixMs: Date.now()
  };
}

function cacheSnapshot(snapshot) {
  if (!snapshot || snapshot.tabId == null) {
    return;
  }

  if (snapshot.activityDisposition === "publish" && snapshot.activityCard) {
    stateApi.upsertCachedSnapshot(cachedSiteSnapshots, snapshot);
    return;
  }

  stateApi.removeCachedSnapshot(cachedSiteSnapshots, snapshot.tabId);
}

function removeCachedSnapshot(tabId) {
  if (tabId == null) {
    return;
  }

  stateApi.removeCachedSnapshot(cachedSiteSnapshots, tabId);
}

function buildStickySnapshot() {
  return stateApi.selectLatestCachedSnapshot(cachedSiteSnapshots);
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
      playbackState: snapshot.playbackState,
      activityDisposition: snapshot.activityDisposition
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
  if (!tab?.id || !isInspectableWebUrl(tab.url)) {
    return buildClearSnapshot(tab);
  }

  const siteDefinition = getSiteDefinitionForUrl(tab.url);
  if (!siteDefinition) {
    return buildClearSnapshot(tab);
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "collectSnapshot" });
    if (response?.snapshot) {
      return normalizeSnapshot(response.snapshot, tab);
    }
  } catch (error) {
    // No content script available for this tab.
  }

  return buildClearSnapshot(tab, siteDefinition.metadata.id);
}

async function refreshCachedSnapshotForTab(tabId) {
  if (tabId == null) {
    return null;
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !getSiteDefinitionForUrl(tab.url)) {
      removeCachedSnapshot(tabId);
      return null;
    }

    const snapshot = await requestSnapshotFromTab(tab);
    cacheSnapshot(snapshot);
    return snapshot;
  } catch (error) {
    removeCachedSnapshot(tabId);
    return null;
  }
}

async function refreshCachedSnapshots() {
  for (const tabId of Array.from(cachedSiteSnapshots.keys())) {
    await refreshCachedSnapshotForTab(tabId);
  }
}

async function publishBestAvailableSnapshot(activeTab = null) {
  const tab = activeTab || await getActiveTab();

  if (!tab) {
    const stickySnapshot = buildStickySnapshot();
    postSnapshot(stickySnapshot || buildClearSnapshot(null), stickySnapshot ? "Using sticky matched browser activity." : "No active browser tab.");
    return;
  }

  if (!isInspectableWebUrl(tab.url)) {
    removeCachedSnapshot(tab.id);
    const stickySnapshot = buildStickySnapshot();
    postSnapshot(stickySnapshot || buildClearSnapshot(tab), stickySnapshot ? "Using sticky matched browser activity." : "Active tab is not an inspectable web page.");
    return;
  }

  const snapshot = await requestSnapshotFromTab(tab);
  cacheSnapshot(snapshot);

  if (snapshot.activityDisposition === "publish" && snapshot.activityCard) {
    postSnapshot(snapshot);
    return;
  }

  const stickySnapshot = buildStickySnapshot();
  postSnapshot(stickySnapshot || snapshot, stickySnapshot ? "Using sticky matched browser activity." : "No matched browser activity for the active tab.");
}

chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
  void updateStatus("wait", { message: "Extension installed. Waiting for active tab scan." });
  void publishBestAvailableSnapshot();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
  void updateStatus("wait", { message: "Browser startup detected. Waiting for active tab scan." });
  void publishBestAvailableSnapshot();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) {
    void refreshCachedSnapshots().then(() => publishBestAvailableSnapshot());
  }
});

chrome.tabs.onActivated.addListener(() => {
  void publishBestAvailableSnapshot();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && !getSiteDefinitionForUrl(changeInfo.url)) {
    removeCachedSnapshot(tabId);
  }

  if (cachedSiteSnapshots.has(tabId) && (changeInfo.status === "complete" || changeInfo.url)) {
    void refreshCachedSnapshotForTab(tabId).then(() => {
      if (tab.active) {
        return publishBestAvailableSnapshot(tab);
      }
      return null;
    });
    return;
  }

  if (tab.active && (changeInfo.status === "complete" || changeInfo.url)) {
    void publishBestAvailableSnapshot(tab);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const removedStickySource = cachedSiteSnapshots.has(tabId);
  removeCachedSnapshot(tabId);
  if (removedStickySource) {
    void publishBestAvailableSnapshot();
  }
});

chrome.windows.onFocusChanged.addListener(() => {
  void publishBestAvailableSnapshot();
});

chrome.action.onClicked.addListener(() => {
  void publishBestAvailableSnapshot();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "snapshot" || !sender.tab) {
    return;
  }

  const snapshot = normalizeSnapshot(message.snapshot, sender.tab);
  cacheSnapshot(snapshot);

  if (sender.tab.active) {
    if (snapshot.activityDisposition === "publish" && snapshot.activityCard) {
      postSnapshot(snapshot);
    } else {
      const stickySnapshot = buildStickySnapshot();
      postSnapshot(stickySnapshot || snapshot, stickySnapshot ? "Using sticky matched browser activity." : "No matched browser activity for the active tab.");
    }
  }

  sendResponse({ ok: true });
});
