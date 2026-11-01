import type { Site } from "../../model/types.js";
import { resolveHref } from "../../model/url.js";

export interface SitemapEntry {
  url: string;
  host: string;
  key: string;
  isIndex: boolean;
}

/** All parseable `<loc>` URLs of the site's sitemaps, in sitemap order. */
export function sitemapEntries(site: Site): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  for (const sm of site.sitemaps) {
    if (!sm.ok) continue;
    for (const url of sm.urls) {
      if (!URL.canParse(url)) continue;
      const u = new URL(url);
      const key = resolveHref(url, "/", u.origin).key ?? u.pathname;
      out.push({ url, host: u.host.toLowerCase(), key, isIndex: sm.isIndex });
    }
  }
  return out;
}

/** Host of `site.site`, lowercase; undefined when the base URL is unknown. */
export function siteHost(site: Site): string | undefined {
  return site.site !== undefined && URL.canParse(site.site)
    ? new URL(site.site).host.toLowerCase()
    : undefined;
}

/** Page URLs listed in sitemaps (not sitemap-index children) that belong to this site. */
export function ownPageEntries(site: Site): SitemapEntry[] {
  const host = siteHost(site);
  return sitemapEntries(site).filter(
    (e) => !e.isIndex && (host === undefined || e.host === host),
  );
}
