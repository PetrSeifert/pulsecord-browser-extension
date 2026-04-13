import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

const registryApi = require("../src/site-registry.js") as DrpcSiteRegistryApi;
const backgroundState = require("../src/background-state.js") as DrpcBackgroundStateApi;
const snapshotGate = require("../src/snapshot-gate.js") as DrpcSnapshotGateApi;
const anime9 = require("../src/sites/9anime.js") as DrpcSiteDefinition;
const netflix = require("../src/sites/netflix.js") as DrpcSiteDefinition;
const siteConfig = require(path.resolve(__dirname, "../../site-config.js")) as DrpcSiteConfigApi;

test.afterEach(() => {
  siteConfig.reset();
  delete (globalThis as { fetch?: typeof fetch }).fetch;
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
  registry.registerSite(netflix);

  const matchedSite = registry.findSiteForUrl("https://www.9animetv.to/watch/example");
  assert.ok(matchedSite);
  assert.equal(matchedSite.metadata.id, "9anime");
  const matchedNetflix = registry.findSiteForUrl("https://www.netflix.com/watch/81234567");
  assert.ok(matchedNetflix);
  assert.equal(matchedNetflix.metadata.id, "netflix");
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

test("9anime browsing pages request elapsed time without browser timestamps", () => {
  const activity = anime9.collectActivity(createSiteContext({
    location: {
      href: "https://www.9animetv.to/search?keyword=naruto",
      pathname: "/search",
      search: "?keyword=naruto"
    }
  }));

  assert.ok(activity && "activityCard" in activity && activity.activityCard);
  assert.equal(activity.activityCard.showElapsedTime, true);
  assert.equal(activity.activityCard.startedAtUnixSeconds, undefined);
  assert.equal(activity.activityCard.endAtUnixSeconds, undefined);
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
  assert.equal(activity.activityCard.details, "Watching: Example Show");
  assert.equal(activity.activityCard.state, "Episode 12");
  assert.equal(activity.activityCard.type, "listening");
  assert.equal(activity.activityCard.assets.largeImage, "https://cdn.example.com/poster.jpg");
  assert.equal(activity.activityCard.assets.smallImage, "");
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
      playbackRate: 1,
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

test("netflix watch page resolves show metadata and timestamps", async () => {
  const mockedFetch = (async () => ({
    ok: true,
    async json() {
      return {
        video: {
          id: 81234567,
          type: "show",
          title: "Example Show",
          synopsis: "A suspense series.",
          currentEpisode: 112,
          boxart: [{ url: "https://cdn.example.com/netflix-show.jpg" }],
          seasons: [
            {
              seq: 2,
              episodes: [
                {
                  episodeId: 112,
                  seq: 4,
                  title: "The Reveal",
                  synopsis: "Everything changes."
                }
              ]
            }
          ]
        }
      };
    }
  })) as unknown as typeof fetch;
  (globalThis as { fetch?: typeof fetch }).fetch = mockedFetch;

  const activity = await netflix.collectActivity(createSiteContext({
    siteDefinition: netflix,
    location: {
      href: "https://www.netflix.com/watch/81234567",
      pathname: "/watch/81234567",
      search: ""
    },
    playbackState: "playing",
    playbackTimestamps: {
      startedAtUnixSeconds: 1709999700,
      endAtUnixSeconds: 1710001200
    },
    metaTags: {
      "og:title": "Example Show | Netflix"
    }
  }));

  assert.ok(activity && "activityCard" in activity && activity.activityCard);
  assert.equal(activity.playbackState, "playing");
  assert.equal(activity.activityCard.details, "Example Show");
  assert.equal(activity.activityCard.state, "S2 E4 - The Reveal");
  assert.equal(activity.activityCard.type, "listening");
  assert.equal(activity.activityCard.assets?.largeImage, "https://cdn.example.com/netflix-show.jpg");
  assert.equal(activity.activityCard.assets?.smallImage, "");
  assert.equal(activity.activityCard.buttons?.[0]?.label, "Watch Episode");
  assert.equal(activity.activityCard.buttons?.[1]?.label, "View Series");
  assert.equal(activity.activityCard.startedAtUnixSeconds, 1709999700);
  assert.equal(activity.activityCard.endAtUnixSeconds, 1710001200);
});

test("netflix title page builds a browsing card from metadata", async () => {
  const mockedFetch = (async () => ({
    ok: true,
    async json() {
      return {
        video: {
          id: 91234567,
          type: "movie",
          title: "Example Movie",
          synopsis: "A feature-length thriller.",
          year: 2024,
          runtime: 7200,
          boxart: [{ url: "https://cdn.example.com/netflix-movie.jpg" }]
        }
      };
    }
  })) as unknown as typeof fetch;
  (globalThis as { fetch?: typeof fetch }).fetch = mockedFetch;

  const activity = await netflix.collectActivity(createSiteContext({
    siteDefinition: netflix,
    location: {
      href: "https://www.netflix.com/title/91234567",
      pathname: "/title/91234567",
      search: ""
    }
  }));

  assert.ok(activity && "activityCard" in activity && activity.activityCard);
  assert.equal(activity.pageTitle, "Example Movie");
  assert.equal(activity.activityCard.details, "Example Movie");
  assert.equal(activity.activityCard.state, "A feature-length thriller.");
  assert.equal(activity.activityCard.assets?.largeImage, "https://cdn.example.com/netflix-movie.jpg");
  assert.equal(activity.activityCard.buttons?.[0]?.label, "Open Netflix");
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

test("snapshot gate tracks full activity card metadata", () => {
  const baseSnapshot: DrpcSnapshotMessage = {
    schemaVersion: 2,
    url: "https://www.netflix.com/watch/81234567",
    host: "www.netflix.com",
    pageTitle: "Example Show",
    siteId: "netflix",
    playbackState: "playing",
    activityDisposition: "publish",
    activityCard: {
      name: "Example Show",
      details: "Example Show",
      state: "S2 E4 - The Reveal",
      type: "listening",
      assets: {
        largeImage: "https://cdn.example.com/poster.jpg",
        smallImage: "",
        smallText: "Playing"
      },
      buttons: [
        {
          label: "Watch Episode",
          url: "https://www.netflix.com/watch/81234567"
        }
      ],
      startedAtUnixSeconds: 1709999700,
      endAtUnixSeconds: 1710001200
    },
    sentAtUnixMs: 1710000000123
  };

  const updatedButtons: DrpcSnapshotMessage = {
    ...baseSnapshot,
    activityCard: {
      ...baseSnapshot.activityCard!,
      buttons: [
        {
          label: "View Series",
          url: "https://www.netflix.com/title/81234567"
        }
      ]
    }
  };

  const updatedAssets: DrpcSnapshotMessage = {
    ...baseSnapshot,
    activityCard: {
      ...baseSnapshot.activityCard!,
      assets: {
        ...baseSnapshot.activityCard!.assets,
        smallImage: "paused",
        smallText: "Paused"
      }
    }
  };

  assert.notEqual(
    snapshotGate.buildSignature(baseSnapshot),
    snapshotGate.buildSignature(updatedButtons)
  );
  assert.notEqual(
    snapshotGate.buildSignature(baseSnapshot),
    snapshotGate.buildSignature(updatedAssets)
  );
});

test("snapshot gate allows immediate media sends but keeps heartbeat throttled", () => {
  const signature = "same-signature";

  assert.equal(snapshotGate.shouldSendSnapshot({
    reason: "media",
    signature,
    lastSignature: signature,
    lastSnapshotSentAt: 1000,
    keepaliveIntervalMs: 10000,
    nowUnixMs: 2000
  }), true);

  assert.equal(snapshotGate.shouldSendSnapshot({
    reason: "heartbeat",
    signature,
    lastSignature: signature,
    lastSnapshotSentAt: 1000,
    keepaliveIntervalMs: 10000,
    nowUnixMs: 5000
  }), false);

  assert.equal(snapshotGate.shouldSendSnapshot({
    reason: "heartbeat",
    signature,
    lastSignature: signature,
    lastSnapshotSentAt: 1000,
    keepaliveIntervalMs: 10000,
    nowUnixMs: 11000
  }), true);
});
