import { isLocalHost } from "../../model/host.js";
import type { FetchRecord, Site } from "../../model/types.js";

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Records of requests to the crawl host, sorted by requested URL. */
export function internalRecords(site: Site): [string, FetchRecord][] {
  const origin = site.origin;
  if (origin === undefined || site.responses === undefined) return [];
  return [...site.responses]
    .filter(([url]) => url.startsWith(`${origin}/`))
    .sort(([a], [b]) => byString(a, b));
}

/** True for a 3xx status code. */
export function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

/** The crawl start URL as the crawler requested it (absolute, with path). */
export function startUrl(site: Site): string {
  return URL.canParse(site.input.root)
    ? new URL(site.input.root.trim()).href
    : site.input.root;
}

/** True when the crawl host is local/private (local runs have no TLS, gzip or caching setup). */
export function isLocalOrigin(site: Site): boolean {
  return (
    site.origin !== undefined &&
    URL.canParse(site.origin) &&
    isLocalHost(new URL(site.origin).hostname)
  );
}

/** At most five examples, sorted, as a list for `details`. */
export function firstExamples(urls: string[]): string[] {
  return [...urls].sort(byString).slice(0, 5);
}
