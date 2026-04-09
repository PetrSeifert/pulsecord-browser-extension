const test = require("node:test");
const assert = require("node:assert/strict");

const adapters = require("../src/adapters-core.js");

test("detectSite identifies Crunchyroll", () => {
  assert.equal(adapters.detectSite("www.crunchyroll.com"), "crunchyroll");
});

test("extractMetadata parses Crunchyroll style titles", () => {
  const metadata = adapters.extractMetadata({
    hostname: "www.crunchyroll.com",
    title: "My Show - Episode 3 - Watch on Crunchyroll",
    metas: {}
  });

  assert.equal(metadata.siteId, "crunchyroll");
  assert.equal(metadata.seriesTitle, "My Show");
  assert.equal(metadata.episodeLabel, "Episode 3");
});

test("extractMetadata parses HIDIVE titles", () => {
  const metadata = adapters.extractMetadata({
    hostname: "www.hidive.com",
    title: "Example Series - Episode 2 - HIDIVE",
    metas: {}
  });

  assert.equal(metadata.siteId, "hidive");
  assert.equal(metadata.seriesTitle, "Example Series");
  assert.equal(metadata.episodeLabel, "Episode 2");
});
