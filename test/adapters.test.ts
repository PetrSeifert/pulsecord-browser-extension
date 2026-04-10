import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

const registryApi = require("../src/site-registry.js") as DrpcSiteRegistryApi;
const backgroundState = require("../src/background-state.js") as DrpcBackgroundStateApi;
const anime9 = require("../src/sites/9anime.js") as DrpcSiteDefinition;
const siteConfig = require(path.resolve(__dirname, "../../site-config.js")) as DrpcSiteConfigApi;

test.afterEach(() => {
  siteConfig.reset();
});

function createSiteContext(
  overrides: Partial<DrpcSiteContext>
): DrpcSiteContext {
  return {
    siteDefinition: anime9,
    siteConfig: {
      enabled: true,
      settings: {},
      activityOverrides: {}
    },
    location: {
      href: "https://www.9animetv.to/",
      pathname: "/",
      search: ""
    },
    document: {
      title: "",
      querySelector() {
        return null;
      }
    },
    media: null,
    metaTags: {},
    nowUnixSeconds: 1710000000,
    playbackState: "idle",
    playbackTimestamps: {},
    embeddedPlayback: null,
    ...overrides
  };
}

test("site registry matches only declared hosts", () => {
  siteConfig.reset();
  const registry = registryApi.createRegistry();
  registry.registerSite(anime9);

  const matchedSite = registry.findSiteForUrl("https://www.9animetv.to/watch/example");
  assert.ok(matchedSite);
  assert.equal(matchedSite.metadata.id, "9anime");
  assert.equal(registry.findSiteForUrl("https://example.com/watch/example"), null);
});

test("site registry skips disabled sites", () => {
  siteConfig.setConfig({
    "9anime": {
      enabled: false
    }
  });

  const registry = registryApi.createRegistry();
  registry.registerSite(anime9);

  assert.equal(registry.findSiteForUrl("https://www.9animetv.to/watch/example"), null);
  siteConfig.reset();
});

test("9anime returns null for undefined pages", () => {
  const activity = anime9.collectActivity(createSiteContext({
    location: {
      href: "https://www.9animetv.to/random",
      pathname: "/random",
      search: ""
    },
    document: {
      title: "Random",
      querySelector() {
        return null;
      }
    }
  }));

  assert.equal(activity, null);
});

test("9anime watch page returns a complete activity card", () => {
  const documentMock = {
    title: "Watch Example Show online free on 9anime",
    querySelector(selector: string) {
      if (selector === ".film-infor .film-name.dynamic-name") {
        return { textContent: "Example Show" };
      }
      if (selector === ".ep-item.active") {
        return {
          textContent: "12",
          dataset: { number: "12" },
          querySelector() {
            return null;
          }
        };
      }
      if (selector === ".anime-poster img") {
        return { src: "https://cdn.example.com/poster.jpg" };
      }
      return null;
    }
  };

  const activity = anime9.collectActivity(createSiteContext({
    location: {
      href: "https://www.9animetv.to/watch/example",
      pathname: "/watch/example",
      search: ""
    },
    playbackState: "playing",
    playbackTimestamps: {
      startedAtUnixSeconds: 1709999700,
      endAtUnixSeconds: 1710001200
    },
    document: documentMock
  }));

  assert.ok(activity && "activityCard" in activity && activity.activityCard);
  assert.ok(activity.activityCard.assets);
  assert.ok(activity.activityCard.buttons);
  assert.equal(activity.activityCard.details, "Watching Example Show");
  assert.equal(activity.activityCard.state, "Episode 12");
  assert.equal(activity.activityCard.type, "listening");
  assert.equal(activity.activityCard.assets.largeImage, "https://cdn.example.com/poster.jpg");
  assert.equal(activity.activityCard.assets.smallImage, "playing");
  assert.equal(activity.activityCard.assets.smallText, "Playing");
  assert.equal(activity.activityCard.buttons[0].label, "Watch Anime");
  assert.equal(activity.activityCard.startedAtUnixSeconds, 1709999700);
});

test("9anime watch page prefers embedded playback telemetry for paused state", () => {
  const documentMock = {
    title: "Watch Example Show online free on 9anime",
    querySelector(selector: string) {
      if (selector === ".film-infor .film-name.dynamic-name") {
        return { textContent: "Example Show" };
      }
      if (selector === ".ep-item.active") {
        return {
          textContent: "12",
          dataset: { number: "12" },
          querySelector() {
            return null;
          }
        };
      }
      if (selector === ".anime-poster img") {
        return { src: "https://cdn.example.com/poster.jpg" };
      }
      return null;
    }
  };

  const activity = anime9.collectActivity(createSiteContext({
    location: {
      href: "https://www.9animetv.to/watch/example",
      pathname: "/watch/example",
      search: ""
    },
    playbackState: "idle",
    playbackTimestamps: {},
    embeddedPlayback: {
      currentTime: 321,
      duration: 1440,
      paused: true,
      receivedAtUnixMs: 1710000000000,
      sourceUrl: "https://www.9animetv.to/player"
    },
    document: documentMock
  }));

  assert.ok(activity && "activityCard" in activity && activity.activityCard);
  assert.equal(activity.playbackState, "paused");
  assert.equal(activity.activityCard.assets?.smallImage, "paused");
  assert.equal(activity.activityCard.assets?.smallText, "Paused");
  assert.equal(activity.activityCard.startedAtUnixSeconds, null);
  assert.equal(activity.activityCard.endAtUnixSeconds, null);
});

test("9anime watch page returns null when title cannot be resolved", () => {
  const activity = anime9.collectActivity(createSiteContext({
    location: {
      href: "https://www.9animetv.to/watch/example",
      pathname: "/watch/example",
      search: ""
    },
    document: {
      title: "",
      querySelector() {
        return null;
      }
    }
  }));

  assert.equal(activity, null);
});

test("sanitizeActivityCard preserves remote image URLs", () => {
  siteConfig.reset();
  const card = registryApi.sanitizeActivityCard({
    details: "Example Show",
    state: "Episode 12",
    assets: {
      largeImage: "https://cdn.example.com/poster.jpg",
      largeUrl: "https://www.9animetv.to/watch/example"
    }
  });

  assert.ok(card);
  assert.ok(card.assets);
  assert.equal(card.assets.largeImage, "https://cdn.example.com/poster.jpg");
  assert.equal(card.assets.largeUrl, "https://www.9animetv.to/watch/example");
});

test("applyActivityOverrides replaces configured activity fields", () => {
  siteConfig.reset();
  const card = registryApi.applyActivityOverrides(
    {
      name: "Example Show",
      details: "Example Show",
      state: "Episode 12",
      type: "playing",
      showElapsedTime: true,
      buttons: [
        {
          label: "Watch Anime",
          url: "https://www.9animetv.to/watch/example"
        }
      ]
    },
    {
      details: "Custom Details",
      state: "Custom State",
      type: "watching",
      showElapsedTime: false,
      buttons: []
    }
  );

  assert.ok(card);
  assert.equal(card.details, "Custom Details");
  assert.equal(card.state, "Custom State");
  assert.equal(card.type, "watching");
  assert.equal(card.showElapsedTime, false);
  assert.deepEqual(card.buttons, []);
});

test("sanitizeActivityCard preserves valid activity type", () => {
  siteConfig.reset();
  const card = registryApi.sanitizeActivityCard({
    details: "Example Show",
    state: "Episode 12",
    type: "watching"
  });

  assert.ok(card);
  assert.equal(card.type, "watching");
});

test("sanitizeActivityCard leaves missing activity type unset", () => {
  siteConfig.reset();
  const card = registryApi.sanitizeActivityCard({
    details: "Example Show",
    state: "Episode 12"
  });

  assert.ok(card);
  assert.equal(card.type, undefined);
});

test("sanitizeActivityCard drops invalid activity type", () => {
  siteConfig.reset();
  const card = registryApi.sanitizeActivityCard({
    details: "Example Show",
    state: "Episode 12",
    type: "invalid" as DrpcActivityType
  });

  assert.ok(card);
  assert.equal(card.type, undefined);
});

test("site config strips legacy persisted type overrides", () => {
  siteConfig.setConfig({
    "9anime": {
      enabled: true,
      activityOverrides: {
        type: "playing",
        details: "Custom Details"
      }
    }
  });

  const config = siteConfig.getSiteConfig("9anime");
  assert.equal(config.activityOverrides?.type, undefined);
  assert.equal(config.activityOverrides?.details, "Custom Details");
});

test("sticky cached snapshot survives switching to an undefined tab", () => {
  const cache = new Map<number, DrpcCachedSnapshotEntry>();
  backgroundState.upsertCachedSnapshot(cache, {
    schemaVersion: 2,
    browser: "chrome",
    tabId: 9,
    url: "https://www.9animetv.to/watch/example",
    host: "www.9animetv.to",
    siteId: "9anime",
    pageTitle: "Example Show",
    playbackState: "playing",
    activityDisposition: "publish",
    activityCard: { details: "Example Show" },
    sentAtUnixMs: 100
  });

  const sticky = backgroundState.selectLatestCachedSnapshot(cache);
  assert.ok(sticky);
  assert.ok(sticky.activityCard);
  assert.equal(sticky.activityDisposition, "sticky");
  assert.equal(sticky.activityCard.details, "Example Show");
});

test("sticky cache clears when the matched source tab is removed", () => {
  const cache = new Map<number, DrpcCachedSnapshotEntry>();
  backgroundState.upsertCachedSnapshot(cache, {
    schemaVersion: 2,
    browser: "chrome",
    tabId: 9,
    url: "https://www.9animetv.to/watch/example",
    host: "www.9animetv.to",
    siteId: "9anime",
    pageTitle: "Example Show",
    playbackState: "playing",
    activityDisposition: "publish",
    activityCard: { details: "Example Show" },
    sentAtUnixMs: 100
  });

  backgroundState.removeCachedSnapshot(cache, 9);
  assert.equal(backgroundState.selectLatestCachedSnapshot(cache), null);
});
