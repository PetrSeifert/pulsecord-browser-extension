importScripts(
  "background-state.js",
  "site-registry.js",
  "sites/crunchyroll.js",
  "sites/hidive.js",
  "sites/9anime.js"
);

const HOST_NAME = "com.drpc.browser_host";
const HEARTBEAT_ALARM = "drpc-heartbeat";

const root = globalThis as DrpcGlobalRoot;
const registry = root.DrpcSiteRegistry;
const stateApi = root.DrpcBackgroundState;
const cachedSiteSnapshots = new Map<number, DrpcCachedSnapshotEntry>();

let nativePort: chrome.runtime.Port | null = null;

async function updateStatus(
  status: "ok" | "wait" | "error",
  details: Record<string, unknown> = {}
): Promise<void> {
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

function detectBrowserName(): "chrome" | "edge" | "opera" {
  const userAgent = navigator.userAgent || "";
  if (userAgent.includes("Edg/")) {
    return "edge";
  }
  if (userAgent.includes("OPR/")) {
    return "opera";
  }
  return "chrome";
}

function ensureNativePort(): chrome.runtime.Port {
  if (nativePort) {
    return nativePort;
  }

  try {
    nativePort = chrome.runtime.connectNative(HOST_NAME);
    void updateStatus("wait", { message: "Connected to native host. Waiting for browser activity." });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void updateStatus("error", { message: `connectNative failed: ${message}` });
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

function isInspectableWebUrl(url?: string): boolean {
  return String(url || "").startsWith("http://") || String(url || "").startsWith("https://");
}

function getSiteDefinitionForUrl(url?: string): DrpcSiteDefinition | null {
  if (!registry) {
    return null;
  }

  return registry.findSiteForUrl(url || "");
}

function buildClearSnapshot(tab: chrome.tabs.Tab | null, siteId = ""): DrpcSnapshot {
  const url = tab?.url || "";
  let host = "";
  try {
    host = new URL(url).host;
  } catch {
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

function normalizeSnapshot(
  snapshot: DrpcSnapshotMessage,
  tab: chrome.tabs.Tab | null,
  dispositionOverride: DrpcActivityDisposition | null = null
): DrpcSnapshot {
  const url = snapshot.url || tab?.url || "";
  let host = snapshot.host || "";
  try {
    host = host || new URL(url).host;
  } catch {
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

function cacheSnapshot(snapshot: DrpcSnapshot): void {
  if (!snapshot || snapshot.tabId == null || !stateApi) {
    return;
  }

  if (snapshot.activityDisposition === "publish" && snapshot.activityCard) {
    stateApi.upsertCachedSnapshot(cachedSiteSnapshots, snapshot);
    return;
  }

  stateApi.removeCachedSnapshot(cachedSiteSnapshots, snapshot.tabId);
}

function removeCachedSnapshot(tabId: number | null | undefined): void {
  if (tabId == null || !stateApi) {
    return;
  }

  stateApi.removeCachedSnapshot(cachedSiteSnapshots, tabId);
}

function buildStickySnapshot(): DrpcSnapshot | null {
  return stateApi ? stateApi.selectLatestCachedSnapshot(cachedSiteSnapshots) : null;
}

function postSnapshot(snapshot: DrpcSnapshot | null, messageOverride: string | null = null): void {
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
    const message = error instanceof Error ? error.message : String(error);
    void updateStatus("error", { message: `postMessage failed: ${message}` });
  }
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });
  return tabs[0] || null;
}

async function requestSnapshotFromTab(tab: chrome.tabs.Tab): Promise<DrpcSnapshot> {
  if (tab.id == null || !isInspectableWebUrl(tab.url)) {
    return buildClearSnapshot(tab);
  }

  const siteDefinition = getSiteDefinitionForUrl(tab.url);
  if (!siteDefinition) {
    return buildClearSnapshot(tab);
  }

  try {
    const response = (await chrome.tabs.sendMessage(tab.id, {
      type: "collectSnapshot"
    })) as { snapshot?: DrpcSnapshotMessage } | undefined;

    if (response?.snapshot) {
      return normalizeSnapshot(response.snapshot, tab);
    }
  } catch {
    // No content script available for this tab.
  }

  return buildClearSnapshot(tab, siteDefinition.metadata.id);
}

async function refreshCachedSnapshotForTab(tabId: number): Promise<DrpcSnapshot | null> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !getSiteDefinitionForUrl(tab.url)) {
      removeCachedSnapshot(tabId);
      return null;
    }

    const snapshot = await requestSnapshotFromTab(tab);
    cacheSnapshot(snapshot);
    return snapshot;
  } catch {
    removeCachedSnapshot(tabId);
    return null;
  }
}

async function refreshCachedSnapshots(): Promise<void> {
  for (const tabId of Array.from(cachedSiteSnapshots.keys())) {
    await refreshCachedSnapshotForTab(tabId);
  }
}

async function publishBestAvailableSnapshot(activeTab: chrome.tabs.Tab | null = null): Promise<void> {
  const tab = activeTab || (await getActiveTab());

  if (!tab) {
    const stickySnapshot = buildStickySnapshot();
    postSnapshot(
      stickySnapshot || buildClearSnapshot(null),
      stickySnapshot ? "Using sticky matched browser activity." : "No active browser tab."
    );
    return;
  }

  if (!isInspectableWebUrl(tab.url)) {
    removeCachedSnapshot(tab.id);
    const stickySnapshot = buildStickySnapshot();
    postSnapshot(
      stickySnapshot || buildClearSnapshot(tab),
      stickySnapshot
        ? "Using sticky matched browser activity."
        : "Active tab is not an inspectable web page."
    );
    return;
  }

  const snapshot = await requestSnapshotFromTab(tab);
  cacheSnapshot(snapshot);

  if (snapshot.activityDisposition === "publish" && snapshot.activityCard) {
    postSnapshot(snapshot);
    return;
  }

  const stickySnapshot = buildStickySnapshot();
  postSnapshot(
    stickySnapshot || snapshot,
    stickySnapshot
      ? "Using sticky matched browser activity."
      : "No matched browser activity for the active tab."
  );
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

  if (cachedSiteSnapshots.has(tabId) && (changeInfo.status === "complete" || Boolean(changeInfo.url))) {
    void refreshCachedSnapshotForTab(tabId).then(() => {
      if (tab.active) {
        return publishBestAvailableSnapshot(tab);
      }
      return null;
    });
    return;
  }

  if (tab.active && (changeInfo.status === "complete" || Boolean(changeInfo.url))) {
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

chrome.runtime.onMessage.addListener((
  message: { type?: string; snapshot?: DrpcSnapshotMessage },
  sender,
  sendResponse
) => {
  if (message?.type !== "snapshot" || !sender.tab || !message.snapshot) {
    return;
  }

  const snapshot = normalizeSnapshot(message.snapshot, sender.tab);
  cacheSnapshot(snapshot);

  if (sender.tab.active) {
    if (snapshot.activityDisposition === "publish" && snapshot.activityCard) {
      postSnapshot(snapshot);
    } else {
      const stickySnapshot = buildStickySnapshot();
      postSnapshot(
        stickySnapshot || snapshot,
        stickySnapshot
          ? "Using sticky matched browser activity."
          : "No matched browser activity for the active tab."
      );
    }
  }

  sendResponse({ ok: true });
});
