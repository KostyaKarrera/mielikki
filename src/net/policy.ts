import { UsageError } from "../errors.js";

/** Parses the start URL of a crawl: http(s) only, without credentials. */
export function parseStartUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UsageError(`Not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new UsageError(`Only http(s) URLs can be checked: ${raw}`);
  if (url.username !== "" || url.password !== "")
    throw new UsageError(`URL must not contain credentials: ${url.host}`);
  return url;
}

function originOf(u: string): string | undefined {
  return URL.canParse(u) ? new URL(u).origin : undefined;
}

/** Rewrites a URL on `siteOrigin` to the same path on `crawlOrigin`; anything else is returned unchanged. */
export function mapToCrawl(
  url: string,
  crawlOrigin: string,
  siteOrigin?: string,
): string {
  const site = siteOrigin === undefined ? undefined : originOf(siteOrigin);
  const crawl = originOf(crawlOrigin);
  if (site === undefined || crawl === undefined || !URL.canParse(url))
    return url;
  const u = new URL(url);
  if (u.origin !== site) return url;
  return `${crawl}${u.pathname}${u.search}${u.hash}`;
}

/** Drops the fragment (and an empty '?'); flags a non-empty query. */
export function normalizeCrawlUrl(url: string): {
  url: string;
  query: boolean;
} {
  let u = url.replace(/#.*$/s, "");
  if (u.endsWith("?")) u = u.slice(0, -1);
  return { url: u, query: u.includes("?") };
}

const ASSET_EXT =
  /\.(jpe?g|png|webp|avif|gif|svg|ico|css|js|mjs|woff2?|ttf|otf|pdf|xml|txt|json|zip|mp4|webmanifest|map)$/i;

/** True for paths of static assets that the page crawl does not request. */
export function isAssetPath(pathname: string): boolean {
  return ASSET_EXT.test(pathname);
}
