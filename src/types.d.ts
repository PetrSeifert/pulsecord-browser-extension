type DrpcPlaybackState = "idle" | "paused" | "playing";
type DrpcActivityDisposition = "publish" | "clear" | "sticky";
type DrpcStatusDisplayType = "name" | "details" | "state";
type DrpcSiteSettingValue = string | number | boolean | null;

interface DrpcActivityButton {
  label?: string;
  url?: string;
}

interface DrpcActivityAssets {
  largeImage?: string;
  largeText?: string;
  largeUrl?: string;
  smallImage?: string;
  smallText?: string;
  smallUrl?: string;
}

interface DrpcActivityCard {
  name?: string;
  details?: string;
  detailsUrl?: string;
  state?: string;
  stateUrl?: string;
  statusDisplayType?: DrpcStatusDisplayType;
  showElapsedTime?: boolean;
  assets?: DrpcActivityAssets;
  buttons?: DrpcActivityButton[];
  startedAtUnixSeconds?: number | null;
  endAtUnixSeconds?: number | null;
}

interface DrpcActivityCardOverrides {
  name?: string;
  details?: string;
  detailsUrl?: string;
  state?: string;
  stateUrl?: string;
  statusDisplayType?: DrpcStatusDisplayType;
  showElapsedTime?: boolean;
  assets?: DrpcActivityAssets;
  buttons?: DrpcActivityButton[];
  startedAtUnixSeconds?: number | null;
  endAtUnixSeconds?: number | null;
}

interface DrpcSiteConfigEntry {
  enabled?: boolean;
  settings?: Record<string, DrpcSiteSettingValue>;
  activityOverrides?: DrpcActivityCardOverrides;
}

interface DrpcResolvedSiteConfig {
  enabled: boolean;
  settings: Record<string, DrpcSiteSettingValue>;
  activityOverrides: DrpcActivityCardOverrides;
}

interface DrpcSnapshotMessage {
  schemaVersion: number;
  browser?: string;
  tabId?: number | null;
  url: string;
  host: string;
  pageTitle: string;
  siteId: string;
  playbackState: DrpcPlaybackState;
  activityDisposition: DrpcActivityDisposition;
  activityCard: DrpcActivityCard | null;
  sentAtUnixMs: number;
}

interface DrpcSnapshot extends DrpcSnapshotMessage {
  browser: string;
  tabId: number | null;
}

interface DrpcCachedSnapshotEntry {
  snapshot: DrpcSnapshot;
  updatedAt: number;
}

interface DrpcPlaybackTimestamps {
  startedAtUnixSeconds?: number;
  endAtUnixSeconds?: number;
}

interface DrpcLocationLike {
  href: string;
  host?: string;
  pathname: string;
  search: string;
}

interface DrpcDocumentLike {
  title?: string;
  querySelector(selector: string): unknown;
}

interface DrpcSiteActivityResult {
  pageTitle?: string;
  playbackState?: DrpcPlaybackState;
  activityCard?: DrpcActivityCard | null;
}

interface DrpcSiteContext {
  siteDefinition: DrpcSiteDefinition | null;
  siteConfig: DrpcResolvedSiteConfig;
  location: DrpcLocationLike;
  document: DrpcDocumentLike;
  media: HTMLMediaElement | null;
  metaTags: Record<string, string>;
  nowUnixSeconds: number;
  playbackState: DrpcPlaybackState;
  playbackTimestamps: DrpcPlaybackTimestamps;
}

interface DrpcSiteDefinition {
  metadata: {
    id: string;
    name: string;
    matches: string[];
  };
  collectActivity(context: DrpcSiteContext): DrpcSiteActivityResult | DrpcActivityCard | null;
}

interface DrpcSiteRegistryRuntime {
  registerSite(site: DrpcSiteDefinition): void;
  getSites(): DrpcSiteDefinition[];
  findSiteForUrl(url: string): DrpcSiteDefinition | null;
}

interface DrpcSiteRegistryApi {
  createRegistry(): DrpcSiteRegistryRuntime;
  matchesPattern(url: string, pattern: string): boolean;
  getSiteConfig(siteId: string): DrpcResolvedSiteConfig;
  sanitizeActivityCard(card: DrpcActivityCard | null | undefined): DrpcActivityCard | null;
  applyActivityOverrides(
    card: DrpcActivityCard | null | undefined,
    overrides: DrpcActivityCardOverrides | null | undefined
  ): DrpcActivityCard | null;
}

interface DrpcSiteConfigApi {
  getSiteConfig(siteId: string): DrpcSiteConfigEntry;
  getAllSiteConfigs(): Record<string, DrpcSiteConfigEntry>;
  setConfig(config: Record<string, DrpcSiteConfigEntry>): void;
  reset(): void;
}

interface DrpcBackgroundStateApi {
  cloneSnapshot(snapshot: DrpcSnapshot, disposition?: DrpcActivityDisposition): DrpcSnapshot;
  upsertCachedSnapshot(
    cache: Map<number, DrpcCachedSnapshotEntry>,
    snapshot: DrpcSnapshot
  ): Map<number, DrpcCachedSnapshotEntry>;
  removeCachedSnapshot(
    cache: Map<number, DrpcCachedSnapshotEntry>,
    tabId: number
  ): Map<number, DrpcCachedSnapshotEntry>;
  selectLatestCachedSnapshot(cache: Map<number, DrpcCachedSnapshotEntry>): DrpcSnapshot | null;
}

type DrpcGlobalRoot = typeof globalThis & {
  DrpcSiteRegistryApi?: DrpcSiteRegistryApi;
  DrpcSiteRegistry?: DrpcSiteRegistryRuntime;
  DrpcSiteConfig?: DrpcSiteConfigApi;
  DrpcBackgroundState?: DrpcBackgroundStateApi;
};

declare function importScripts(...urls: string[]): void;
