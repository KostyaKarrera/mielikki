import type { FetchRecord, Site } from "../model/types.js";
import { mapToCrawl, normalizeCrawlUrl } from "../net/policy.js";

/**
 * URL mode: what the crawl learned about an internal URL.
 * - `ok`: it was requested and answered (2xx, or it redirected; links/redirected
 *   and http/redirect-chain cover redirects).
 * - `broken`: it was requested and ended with status >= 400, or did not answer
 *   (timeout, network error, body too large); `reason` says which.
 * - `unknown`: it was never requested (page limit, asset budget, query,
 *   --respect-robots), so nothing can be said about it.
 */
export type Reach =
  | { state: "ok" }
  | { state: "broken"; reason: string }
  | { state: "unknown" };

const FAILED_STOPS = new Set(["timeout", "network", "too-large"]);

/** True when a check runs against a crawled site (decisions come from site.responses). */
export function isCrawled(
  site: Site,
): site is Site & { origin: string; responses: Map<string, FetchRecord> } {
  return (
    site.input.kind === "url" &&
    site.origin !== undefined &&
    site.responses !== undefined
  );
}

/** Records by their final URL, for URLs only reached as a redirect target. */
const byFinal = new WeakMap<
  Map<string, FetchRecord>,
  Map<string, FetchRecord>
>();

function finalIndex(
  responses: Map<string, FetchRecord>,
): Map<string, FetchRecord> {
  let index = byFinal.get(responses);
  if (index === undefined) {
    index = new Map();
    for (const [url, rec] of [...responses].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )) {
      const f = rec.final?.url;
      if (f === undefined || !URL.canParse(f)) continue;
      const key = normalizeCrawlUrl(f).url;
      if (key !== url && !index.has(key)) index.set(key, rec);
    }
    byFinal.set(responses, index);
  }
  return index;
}

function reachOf(rec: FetchRecord): Reach {
  if (rec.stop !== undefined)
    return FAILED_STOPS.has(rec.stop)
      ? { state: "broken", reason: `did not answer (${rec.stop})` }
      : { state: "ok" }; // left-site, redirect-loop, too-many-redirects
  const status = rec.final?.status;
  if (status === undefined)
    return { state: "broken", reason: "did not answer (network)" };
  if (status === 404 || status === 410)
    return { state: "broken", reason: "does not exist" };
  if (status >= 400)
    return { state: "broken", reason: `answers HTTP ${status}` };
  return { state: "ok" };
}

/** URL of `key` on the crawl host, as the asset loader requests it. */
export function keyUrl(origin: string, key: string): string {
  return `${origin}${encodeURI(key)}`;
}

/**
 * What is known about the first of `urls` that was requested (or reached as
 * the final URL of a redirect); `unknown` when none was.
 */
export function reachOfUrls(
  site: Site & { responses: Map<string, FetchRecord> },
  urls: readonly string[],
): Reach {
  for (const u of urls) {
    const rec = site.responses.get(u);
    if (rec !== undefined) return reachOf(rec);
  }
  const index = finalIndex(site.responses);
  for (const u of urls) {
    const rec = index.get(u);
    if (rec !== undefined) return reachOf(rec);
  }
  return { state: "unknown" };
}

/**
 * URL mode: what is known about an internal `href` on a page with final URL
 * `base`. The URL is built exactly as the crawler built it (resolved against
 * the page URL, config.site host mapped to the crawl host, fragment dropped);
 * for a file (key without a trailing slash) the asset loader's URL is tried too.
 */
export function linkReach(
  site: Site & { origin: string; responses: Map<string, FetchRecord> },
  href: string,
  base: string,
  key: string,
): Reach {
  const urls: string[] = [];
  if (URL.canParse(href.trim(), base)) {
    const abs = new URL(href.trim(), base);
    const cfg = site.config.site;
    const siteOrigin =
      cfg !== undefined && URL.canParse(cfg) ? new URL(cfg).origin : undefined;
    const url = normalizeCrawlUrl(
      mapToCrawl(abs.href, site.origin, siteOrigin),
    ).url;
    if (new URL(url).origin === site.origin) urls.push(url);
  }
  if (!key.endsWith("/")) urls.push(keyUrl(site.origin, key));
  return reachOfUrls(site, urls);
}

/** Final URL of a crawled page (its request URL when it has none). */
export function pageBase(
  site: Site & { origin: string },
  page: {
    key: string;
    url?: string;
  },
): string {
  return page.url ?? keyUrl(site.origin, page.key);
}
