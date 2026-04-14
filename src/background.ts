importScripts(
  "../../site-config.js",
  "background-state.js",
  "site-registry.js",
  "sites/crunchyroll.js",
  "sites/hidive.js",
  "sites/9anime.js",
  "sites/netflix.js"
);

const HOST_NAME = "com.drpc.browser_host";
const HEARTBEAT_ALARM = "drpc-heartbeat";
const CONFIG_STORAGE_KEY = "drpcSiteConfig";

const root = globalThis as DrpcGlobalRoot;
const registry = root.DrpcSiteRegistry;
const siteConfigApi = root.DrpcSiteConfig;
const stateApi = root.DrpcBackgroundState;
const cachedSiteSnapshots = new Map<number, DrpcCachedSnapshotEntry>();
let nativeSendQueue: Promise<void> = Promise.resolve();

function loadPersistedConfig(): void {
  if (!siteConfigApi) return;
  chrome.storage.local.get(CONFIG_STORAGE_KEY, (result) => {
    const saved = result[CONFIG_STORAGE_KEY];
    if (saved && typeof saved === "object") {
      siteConfigApi.setConfig(saved as Record<string, DrpcSiteConfigEntry>);
    }
  });
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes[CONFIG_STORAGE_KEY] && siteConfigApi) {
    const newConfig = changes[CONFIG_STORAGE_KEY].newValue;
    if (newConfig && typeof newConfig === "object") {
      siteConfigApi.setConfig(newConfig as Record<string, DrpcSiteConfigEntry>);
    }
  }
});

loadPersistedConfig();

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

type DrpcNativeHostResponse = {
  ok?: boolean;
  error?: string;
} | null | undefined;

async function sendSnapshotToNativeHost(
  snapshot: DrpcSnapshot,
  messageOverride: string | null = null
): Promise<void> {
  try {
    const response = (await chrome.runtime.sendNativeMessage(
      HOST_NAME,
      snapshot
    )) as DrpcNativeHostResponse;

    if (!response?.ok) {
      const message = response?.error || "Native host rejected the snapshot.";
      await updateStatus("error", { message });
      return;
    }

    await updateStatus("ok", {
      message: messageOverride || "Snapshot forwarded to native host.",
      host: snapshot.host,
      pageTitle: snapshot.pageTitle,
      playbackState: snapshot.playbackState,
      activityDisposition: snapshot.activityDisposition
    });
  } catch (error) {
    console.warn("Failed to send drpc snapshot:", error);
    const message = error instanceof Error ? error.message : String(error);
    await updateStatus("error", { message: `sendNativeMessage failed: ${message}` });
  }
}

function postSnapshot(snapshot: DrpcSnapshot | null, messageOverride: string | null = null): void {
  if (!snapshot) {
    return;
  }

  nativeSendQueue = nativeSendQueue
    .catch(() => undefined)
    .then(() => sendSnapshotToNativeHost(snapshot, messageOverride));
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });
  return tabs[0] || null;
}

async function requestSnapshotFromTab(tab: chrome.tabs.Tab): Promise<DrpcSnapshot | null> {
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
    return null;
  }

  return null;
}

async function refreshCachedSnapshotForTab(tabId: number): Promise<DrpcSnapshot | null> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !getSiteDefinitionForUrl(tab.url)) {
      removeCachedSnapshot(tabId);
      return null;
    }

    const snapshot = await requestSnapshotFromTab(tab);
    if (!snapshot) {
      return cachedSiteSnapshots.get(tabId)?.snapshot || null;
    }
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
  if (!snapshot) {
    const stickySnapshot = buildStickySnapshot();
    if (stickySnapshot) {
      postSnapshot(stickySnapshot, "Using sticky matched browser activity.");
      return;
    }

    return;
  }
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
