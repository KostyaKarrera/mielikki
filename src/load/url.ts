import type { Config } from "../config/schema.js";
import { UsageError } from "../errors.js";
import { isIgnored } from "../model/indexable.js";
import type { FetchRecord, Page, Site } from "../model/types.js";
import { pageKey } from "../model/url.js";
import type { Fetcher } from "../net/fetch.js";
import {
  isAssetPath,
  mapToCrawl,
  normalizeCrawlUrl,
  parseStartUrl,
} from "../net/policy.js";
import { parsePage } from "../parse/page.js";
import { parseRobots, type RobotsInfo } from "../parse/robots.js";
import type { SitemapInfo } from "../parse/sitemap.js";
import {
  buildSiteGraph,
  collectSitemaps,
  DEFAULT_SITEMAPS,
  detectSite,
} from "./graph.js";
import { formProbeUrls, loadAssets, runProbes } from "./probes.js";

export interface CrawlOptions {
  maxPages: number;
  maxAssets: number;
  respectRobots: boolean;
}

const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"]);
/** Directives that carry a value after ':' (not a user-agent prefix). */
const VALUE_DIRECTIVES = new Set([
  "unavailable_after",
  "max-snippet",
  "max-image-preview",
  "max-video-preview",
]);

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Media type without parameters, lowercase (Ruling D). */
function mediaType(contentType: string | undefined): string {
  return contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
}

/** X-Robots-Tag tokens for all agents and Googlebot; other agents' tokens are dropped. */
function xRobotsTokens(header: string | undefined): string[] {
  if (header === undefined) return [];
  const out: string[] = [];
  let agent: string | undefined;
  for (const raw of header.toLowerCase().split(",")) {
    let token = raw.trim();
    const m = /^([a-z0-9_.-]+)\s*:\s*(.*)$/.exec(token);
    if (m && !VALUE_DIRECTIVES.has(m[1] as string)) {
      agent = m[1];
      token = (m[2] as string).trim();
    }
    if (agent !== undefined && agent !== "googlebot") continue;
    for (const t of token.split(/\s+/)) {
      if (t === "") continue;
      if (t === "none") out.push("noindex", "nofollow");
      else out.push(t);
    }
  }
  return out;
}

function pageFrom(rec: FetchRecord): Page | undefined {
  const f = rec.final;
  if (
    f === undefined ||
    f.status !== 200 ||
    f.body === undefined ||
    !HTML_TYPES.has(mediaType(f.contentType ?? f.headers["content-type"]))
  )
    return undefined;
  const page = parsePage(f.body, pageKey(new URL(f.url).pathname));
  page.status = f.status;
  page.headers = f.headers;
  page.url = f.url;
  for (const t of xRobotsTokens(f.headers["x-robots-tag"]))
    if (!page.robotsMeta.includes(t)) page.robotsMeta.push(t);
  return page;
}

export async function loadUrl(
  startUrl: string,
  config: Config,
  fetcher: Fetcher,
  opts: CrawlOptions,
): Promise<Site> {
  const start = parseStartUrl(startUrl);
  const crawlOrigin = start.origin;
  const siteOrigin =
    config.site !== undefined && URL.canParse(config.site)
      ? new URL(config.site).origin
      : undefined;
  const responses = new Map<string, FetchRecord>();

  /** Absolute crawl URL for `href` seen at `base`, or undefined if it is not on the crawl host. */
  const toCrawl = (href: string, base: string): string | undefined => {
    let abs: URL;
    try {
      abs = new URL(href.trim(), base);
    } catch {
      return undefined;
    }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") return undefined;
    const mapped = mapToCrawl(abs.href, crawlOrigin, siteOrigin);
    return new URL(mapped).origin === crawlOrigin ? mapped : undefined;
  };

  // Every request goes through here: never to a host other than the crawl host,
  // except the two fixed URL-form probe URLs (http:// and www. variants, follow:false).
  const probeUrls = new Set(formProbeUrls(start.href));
  const guarded: Fetcher = {
    get(url, o) {
      if (new URL(url).origin !== crawlOrigin && !probeUrls.has(url))
        throw new Error(`refusing to request off-host URL ${url}`);
      return fetcher.get(url, o);
    },
  };
  const request = (url: string): Promise<FetchRecord> => guarded.get(url);
  const get = async (url: string): Promise<FetchRecord> => {
    const rec = await request(url);
    responses.set(url, rec);
    return rec;
  };

  // robots.txt
  const robotsUrl = `${crawlOrigin}/robots.txt`;
  const robotsRec = await get(robotsUrl);
  const robotsRaw =
    robotsRec.final?.status === 200 ? (robotsRec.final.body ?? "") : undefined;
  let robots: RobotsInfo | undefined =
    robotsRaw === undefined
      ? undefined
      : parseRobots(robotsRaw, config.site ?? crawlOrigin);

  // sitemaps
  const sitemaps: SitemapInfo[] = await collectSitemaps({
    listed: robots?.sitemaps ?? [],
    defaults: DEFAULT_SITEMAPS.map((p) => `${crawlOrigin}${p}`),
    locate: (loc) =>
      URL.canParse(loc.trim())
        ? mapToCrawl(new URL(loc.trim()).href, crawlOrigin, siteOrigin)
        : undefined,
    read: async (url, mustExist) => {
      if (new URL(url).origin !== crawlOrigin)
        return { error: "listed on another host, not fetched" };
      const rec = await get(url);
      if (rec.stop !== undefined) return { error: rec.stop };
      const f = rec.final;
      if (f === undefined) return { error: "network" };
      if (f.status !== 200)
        return mustExist || f.status !== 404
          ? { error: `HTTP ${f.status}` }
          : undefined;
      // A default path answered by an HTML page (soft 404) is not a sitemap.
      if (!mustExist && HTML_TYPES.has(mediaType(f.contentType)))
        return undefined;
      return f.body ?? "";
    },
  });

  // Crawl, level by level.
  const seen = new Set<string>();
  const skipped = new Set<string>();
  let limitReached = false;
  const pages = new Map<string, Page>();

  // A start URL that ends up on another origin (http -> https, apex -> www,
  // another port) would make every link look off-host: refuse, naming the target.
  const checkStartOrigin = (rec: FetchRecord): void => {
    const last = rec.hops.at(-1);
    let final: string | undefined = rec.final?.url;
    if (final === undefined && rec.stop === "left-site" && last?.location)
      final = URL.canParse(last.location, last.url)
        ? mapToCrawl(
            new URL(last.location, last.url).href,
            crawlOrigin,
            siteOrigin,
          )
        : undefined;
    if (final === undefined || !URL.canParse(final)) return;
    const origin = new URL(final).origin;
    if (origin !== crawlOrigin)
      throw new UsageError(
        `Start URL redirects to ${origin}; check that URL instead`,
      );
  };

  const startUrlNorm = normalizeCrawlUrl(start.href).url;
  let level: string[] = [startUrlNorm];
  for (const sm of sitemaps)
    if (sm.ok && !sm.isIndex)
      for (const loc of sm.urls) {
        const u = toCrawl(loc, crawlOrigin);
        if (u !== undefined) level.push(u);
      }
  // Configured target pages are seeded like sitemap URLs: a real page that
  // nothing links to is then found (crawl/orphan), not reported as missing.
  for (const t of config.targets.pages) {
    const u = toCrawl(t.url, crawlOrigin);
    if (u !== undefined) level.push(u);
  }

  while (level.length > 0) {
    const toFetch: string[] = [];
    const candidates = [
      ...new Set(level.map((u) => normalizeCrawlUrl(u).url)),
    ].sort(byString);
    for (const url of candidates) {
      if (seen.has(url)) continue;
      seen.add(url);
      const u = new URL(url);
      if (isAssetPath(u.pathname)) continue;
      // The start URL is explicitly asked for; discovered URLs with a query are not crawled.
      if (normalizeCrawlUrl(url).query && url !== startUrlNorm) {
        skipped.add(url);
        continue;
      }
      // --respect-robots obeys robots.txt for everything but the start URL,
      // which was asked for explicitly.
      if (
        opts.respectRobots &&
        url !== startUrlNorm &&
        robots !== undefined &&
        !robots.isAllowed(u.pathname, "*")
      ) {
        skipped.add(url);
        continue;
      }
      toFetch.push(url);
    }

    // The start URL always goes first, so the page limit never cuts it.
    const startAt = toFetch.indexOf(startUrlNorm);
    if (startAt > 0) toFetch.unshift(...toFetch.splice(startAt, 1));

    const next: string[] = [];
    let i = 0;
    while (i < toFetch.length) {
      const room = opts.maxPages - pages.size;
      if (room <= 0) {
        limitReached = true;
        for (const u of toFetch.slice(i)) skipped.add(u);
        break;
      }
      const batch = toFetch.slice(i, i + room);
      i += batch.length;
      const recs = await Promise.all(batch.map(request));
      // Results are handled in sorted order, so Site does not depend on timing.
      batch.forEach((url, n) => {
        const rec = recs[n] as FetchRecord;
        if (url === startUrlNorm) checkStartOrigin(rec);
        responses.set(url, rec);
        if (rec.final === undefined) return;
        // A page that redirected off the crawl origin (e.g. to https://) is a
        // redirect (links/redirected), not a crawled page.
        if (new URL(rec.final.url).origin !== crawlOrigin) return;
        seen.add(normalizeCrawlUrl(rec.final.url).url);
        const page = pageFrom(rec);
        if (page === undefined || pages.has(page.key)) return;
        pages.set(page.key, page);
        for (const l of page.links) {
          const u = toCrawl(l.href, rec.final.url);
          if (u !== undefined) next.push(u);
        }
      });
    }
    level = next;
  }

  const sorted = [...pages.values()].sort((a, b) => byString(a.key, b.key));
  const siteUrl = config.site ?? detectSite(sorted) ?? crawlOrigin;
  if (robotsRaw !== undefined) robots = parseRobots(robotsRaw, siteUrl);
  const { byKey, unique, inlinks, inlinksAll, depth } = buildSiteGraph({
    pages: sorted,
    siteUrl,
    config,
  });

  const site: Site = {
    input: { kind: "url", root: startUrl },
    config,
    site: siteUrl,
    // exclude.ignore: crawled and kept in byKey/inlinks/depth, but not checked.
    pages: unique.filter((p) => !isIgnored(config, p.key)),
    robots,
    sitemaps,
    assets: new Map(),
    byKey,
    inlinks,
    inlinksAll,
    depth,
    origin: crawlOrigin,
    responses,
    crawl: {
      limitReached,
      skipped: [...skipped].sort(byString),
    },
  };
  await loadAssets(site, guarded, opts.maxAssets);
  await runProbes(site, guarded);
  return site;
}
