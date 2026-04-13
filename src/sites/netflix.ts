(function(root, factory) {
  const site = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = site;
  }
  if (root.DrpcSiteRegistry) {
    root.DrpcSiteRegistry.registerSite(site);
  }
})(
  globalThis as DrpcGlobalRoot,
  function(): DrpcSiteDefinition {
    const LOGO_URL = "https://cdn.rcd.gg/PreMiD/websites/N/Netflix/assets/logo.png";
    const PAUSED_ASSET = "paused";
    const METADATA_ENDPOINT =
      "https://www.netflix.com/nq/website/memberapi/release/metadata?movieid=";
    const metadataCache = new Map<string, Promise<NetflixMetadataRoot | null>>();

    interface NetflixImageAsset {
      url?: string;
    }

    interface NetflixEpisode {
      episodeId?: number;
      seq?: number;
      title?: string;
      synopsis?: string;
    }

    interface NetflixSeason {
      seq?: number;
      episodes?: NetflixEpisode[];
    }

    interface NetflixVideoBase {
      id?: number;
      title?: string;
      synopsis?: string;
      boxart?: NetflixImageAsset[];
      type?: "show" | "movie";
    }

    interface NetflixShowVideo extends NetflixVideoBase {
      type: "show";
      currentEpisode?: number;
      seasons?: NetflixSeason[];
    }

    interface NetflixMovieVideo extends NetflixVideoBase {
      type: "movie";
      year?: number;
      runtime?: number;
    }

    interface NetflixMetadataRoot {
      video?: NetflixShowVideo | NetflixMovieVideo;
    }

    function cleanText(value: unknown): string {
      return String(value || "").replace(/\s+/g, " ").trim();
    }

    function cleanTitle(value: unknown): string {
      return cleanText(value)
        .replace(/\s*\|\s*Netflix(?: Official Site)?$/i, "")
        .replace(/\s*-\s*Netflix$/i, "")
        .trim();
    }

    function extractNumericId(value: unknown): string {
      const matched = String(value || "").match(/\d+/);
      return matched ? matched[0] : "";
    }

    function getTitleId(locationRef: DrpcLocationLike): string {
      const pathname = String(locationRef.pathname || "");
      const titleMatch = pathname.match(/\/title\/(\d+)/);
      if (titleMatch?.[1]) {
        return titleMatch[1];
      }

      const params = new URLSearchParams(locationRef.search || "");
      return extractNumericId(params.get("jbv"));
    }

    function getWatchId(locationRef: DrpcLocationLike): string {
      const pathname = String(locationRef.pathname || "");
      const watchMatch = pathname.match(/\/watch\/(\d+)/);
      return watchMatch?.[1] || "";
    }

    function getEffectivePlaybackState(context: DrpcSiteContext): DrpcPlaybackState {
      if (context.embeddedPlayback) {
        return context.embeddedPlayback.paused ? "paused" : "playing";
      }

      return context.playbackState;
    }

    function getEffectivePlaybackTimestamps(context: DrpcSiteContext): DrpcPlaybackTimestamps {
      if (!context.embeddedPlayback) {
        return context.playbackTimestamps;
      }

      return {
        startedAtUnixSeconds: context.embeddedPlayback.startedAtUnixSeconds,
        endAtUnixSeconds: context.embeddedPlayback.endAtUnixSeconds
      };
    }

    function getPosterUrl(
      video: NetflixShowVideo | NetflixMovieVideo | null,
      context: DrpcSiteContext
    ): string {
      if (Array.isArray(video?.boxart)) {
        for (const asset of video.boxart) {
          const url = cleanText(asset?.url);
          if (url) {
            return url;
          }
        }
      }

      return cleanText(context.metaTags["og:image"]) || LOGO_URL;
    }

    function getMetadataVideo(
      metadata: NetflixMetadataRoot | null
    ): NetflixShowVideo | NetflixMovieVideo | null {
      if (!metadata?.video || typeof metadata.video !== "object") {
        return null;
      }

      return metadata.video;
    }

    function findCurrentEpisode(video: NetflixShowVideo): {
      season: NetflixSeason | null;
      episode: NetflixEpisode | null;
    } {
      const currentEpisodeId = Number(video.currentEpisode);
      if (!Array.isArray(video.seasons) || !Number.isFinite(currentEpisodeId)) {
        return {
          season: null,
          episode: null
        };
      }

      for (const season of video.seasons) {
        const episodes = Array.isArray(season.episodes) ? season.episodes : [];
        const episode = episodes.find((entry) => Number(entry?.episodeId) === currentEpisodeId) || null;
        if (episode) {
          return {
            season,
            episode
          };
        }
      }

      return {
        season: null,
        episode: null
      };
    }

    function formatEpisodeState(season: NetflixSeason | null, episode: NetflixEpisode | null): string {
      const seasonNumber = Number(season?.seq);
      const episodeNumber = Number(episode?.seq);
      const episodeTitle = cleanText(episode?.title);

      if (Number.isFinite(seasonNumber) && Number.isFinite(episodeNumber) && episodeTitle) {
        return `S${seasonNumber} E${episodeNumber} - ${episodeTitle}`;
      }
      if (Number.isFinite(seasonNumber) && Number.isFinite(episodeNumber)) {
        return `Season ${seasonNumber}, Episode ${episodeNumber}`;
      }
      if (episodeTitle) {
        return episodeTitle;
      }

      return "Watching on Netflix";
    }

    function formatEpisodeLargeText(season: NetflixSeason | null, episode: NetflixEpisode | null): string {
      const seasonNumber = Number(season?.seq);
      const episodeNumber = Number(episode?.seq);
      if (Number.isFinite(seasonNumber) && Number.isFinite(episodeNumber)) {
        return `Season ${seasonNumber}, Episode ${episodeNumber}`;
      }

      return cleanText(episode?.title) || "Netflix";
    }

    function formatMovieState(video: NetflixMovieVideo): string {
      const parts: string[] = [];
      const year = Number(video.year);
      const runtime = Number(video.runtime);

      if (Number.isFinite(year) && year > 0) {
        parts.push(String(year));
      }
      if (Number.isFinite(runtime) && runtime > 0) {
        parts.push(`${Math.floor(runtime / 60)} minutes`);
      }

      return parts.join(" • ") || cleanText(video.synopsis) || "Watching on Netflix";
    }

    function getSearchQuery(locationRef: DrpcLocationLike): string {
      const params = new URLSearchParams(locationRef.search || "");
      return cleanText(params.get("q") || params.get("query"));
    }

    function createBrowsingCard(
      details: string,
      state: string,
      url: string,
      assets?: DrpcActivityAssets
    ): DrpcActivityCard {
      return {
        details,
        state,
        type: "playing",
        statusDisplayType: "details",
        showElapsedTime: true,
        assets: {
          largeImage: LOGO_URL,
          largeText: "Netflix",
          largeUrl: url,
          ...(assets || {})
        },
        buttons: [
          {
            label: "Open Netflix",
            url
          }
        ]
      };
    }

    async function fetchMetadata(movieId: string): Promise<NetflixMetadataRoot | null> {
      const normalizedId = extractNumericId(movieId);
      if (!normalizedId) {
        return null;
      }

      const cached = metadataCache.get(normalizedId);
      if (cached) {
        return cached;
      }

      const request = fetch(`${METADATA_ENDPOINT}${encodeURIComponent(normalizedId)}`, {
        credentials: "include"
      })
        .then(async (response) => {
          if (!response.ok) {
            return null;
          }

          const payload = (await response.json()) as NetflixMetadataRoot | null;
          return payload && typeof payload === "object" ? payload : null;
        })
        .catch(() => null);

      metadataCache.set(normalizedId, request);
      return request;
    }

    return {
      metadata: {
        id: "netflix",
        name: "Netflix",
        matches: ["https://*.netflix.com/*"]
      },
      async collectActivity(context) {
        const pathname = String(context.location.pathname || "");
        const playbackState = getEffectivePlaybackState(context);
        const playbackTimestamps = getEffectivePlaybackTimestamps(context);
        const playing = playbackState === "playing";
        const watchId = getWatchId(context.location);

        if (watchId) {
          const canonicalWatchUrl = context.location.href.split("?")[0] || context.location.href;
          const metadata = await fetchMetadata(watchId);
          const video = getMetadataVideo(metadata);
          const fallbackTitle =
            cleanTitle(context.metaTags["og:title"]) ||
            cleanTitle(context.metaTags["twitter:title"]) ||
            cleanTitle(context.document.title) ||
            "Netflix";

          if (video?.type === "show") {
            const { season, episode } = findCurrentEpisode(video);
            return {
              pageTitle: cleanText(video.title) || fallbackTitle,
              playbackState,
              activityCard: {
                name: cleanText(video.title) || "Netflix",
                details: cleanText(video.title) || fallbackTitle,
                state: formatEpisodeState(season, episode),
                type: "listening",
                statusDisplayType: "details",
                showElapsedTime: Boolean(playing && playbackTimestamps.startedAtUnixSeconds),
                startedAtUnixSeconds: playing ? playbackTimestamps.startedAtUnixSeconds ?? null : null,
                endAtUnixSeconds: playing ? playbackTimestamps.endAtUnixSeconds ?? null : null,
                assets: {
                  largeImage: getPosterUrl(video, context),
                  largeText: formatEpisodeLargeText(season, episode),
                  largeUrl: canonicalWatchUrl,
                  smallImage: playing ? "" : PAUSED_ASSET,
                  smallText: playing ? "Playing" : "Paused"
                },
                buttons: [
                  {
                    label: "Watch Episode",
                    url: canonicalWatchUrl
                  },
                  {
                    label: "View Series",
                    url: `https://www.netflix.com/title/${extractNumericId(video.id)}`
                  }
                ]
              }
            };
          }

          if (video?.type === "movie") {
            return {
              pageTitle: cleanText(video.title) || fallbackTitle,
              playbackState,
              activityCard: {
                name: cleanText(video.title) || "Netflix",
                details: cleanText(video.title) || fallbackTitle,
                state: formatMovieState(video),
                type: "listening",
                statusDisplayType: "details",
                showElapsedTime: Boolean(playing && playbackTimestamps.startedAtUnixSeconds),
                startedAtUnixSeconds: playing ? playbackTimestamps.startedAtUnixSeconds ?? null : null,
                endAtUnixSeconds: playing ? playbackTimestamps.endAtUnixSeconds ?? null : null,
                assets: {
                  largeImage: getPosterUrl(video, context),
                  largeText: cleanText(video.title) || "Netflix",
                  largeUrl: canonicalWatchUrl,
                  smallImage: playing ? "" : PAUSED_ASSET,
                  smallText: playing ? "Playing" : "Paused"
                },
                buttons: [
                  {
                    label: "Watch Movie",
                    url: canonicalWatchUrl
                  }
                ]
              }
            };
          }

          return {
            pageTitle: fallbackTitle,
            playbackState,
            activityCard: {
              name: fallbackTitle || "Netflix",
              details: fallbackTitle || "Netflix",
              state: cleanText(context.metaTags["og:description"]) || "Watching on Netflix",
              type: "listening",
              statusDisplayType: "details",
              showElapsedTime: Boolean(playing && playbackTimestamps.startedAtUnixSeconds),
              startedAtUnixSeconds: playing ? playbackTimestamps.startedAtUnixSeconds ?? null : null,
              endAtUnixSeconds: playing ? playbackTimestamps.endAtUnixSeconds ?? null : null,
              assets: {
                largeImage: cleanText(context.metaTags["og:image"]) || LOGO_URL,
                largeText: "Netflix",
                largeUrl: canonicalWatchUrl,
                smallImage: playing ? "" : PAUSED_ASSET,
                smallText: playing ? "Playing" : "Paused"
              },
              buttons: [
                {
                  label: "Open Netflix",
                  url: canonicalWatchUrl
                }
              ]
            }
          };
        }

        const titleId = getTitleId(context.location);
        if (titleId) {
          const metadata = await fetchMetadata(titleId);
          const video = getMetadataVideo(metadata);
          if (!video) {
            return null;
          }

          const synopsis = cleanText(video.synopsis) || "Browsing Netflix";
          const title = cleanText(video.title) || "Netflix";
          return {
            pageTitle: title,
            activityCard: createBrowsingCard(title, synopsis, context.location.href, {
              largeImage: getPosterUrl(video, context),
              largeText: title,
              largeUrl: context.location.href
            })
          };
        }

        if (pathname === "/" || pathname === "/browse") {
          return {
            pageTitle: "Netflix",
            activityCard: createBrowsingCard(
              "Viewing Homepage",
              "Browsing Netflix",
              context.location.href
            )
          };
        }

        if (pathname.startsWith("/browse/latest")) {
          return {
            pageTitle: "Netflix Latest",
            activityCard: createBrowsingCard(
              "Viewing what's new and popular",
              "Browsing Netflix",
              context.location.href
            )
          };
        }

        if (pathname.startsWith("/browse/my-list")) {
          return {
            pageTitle: "Netflix My List",
            activityCard: createBrowsingCard(
              "Viewing My List",
              "Browsing Netflix",
              context.location.href
            )
          };
        }

        if (pathname.startsWith("/ManageProfiles")) {
          return {
            pageTitle: "Netflix Profiles",
            activityCard: createBrowsingCard(
              "Managing profiles",
              "Browsing Netflix",
              context.location.href
            )
          };
        }

        if (pathname.startsWith("/search")) {
          const query = getSearchQuery(context.location);
          if (!query) {
            return null;
          }

          return {
            pageTitle: `Netflix Search: ${query}`,
            activityCard: createBrowsingCard(
              `Viewing results for ${query}`,
              "Searching Netflix",
              context.location.href
            )
          };
        }

        if (pathname.startsWith("/browse/genre/")) {
          const genreId = pathname.split("/")[3] || "";
          const genreLabel = genreId ? `Genre ${genreId}` : "Genres";
          return {
            pageTitle: `Netflix ${genreLabel}`,
            activityCard: createBrowsingCard(
              `Browsing ${genreLabel}`,
              "Browsing Netflix",
              context.location.href
            )
          };
        }

        return null;
      }
    };
  }
);
