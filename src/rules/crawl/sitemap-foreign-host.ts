import { isLocalHost } from "../../model/host.js";
import type { SiteRule } from "../types.js";
import { siteHost, sitemapEntries } from "./_helpers.js";

export const rule: SiteRule = {
  meta: {
    id: "crawl/sitemap-foreign-host",
    title: "Sitemap points to another host",
    category: "crawl",
    severity: "error",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: true,
    fix: "Generate the sitemap with the production domain, not localhost or staging.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap",
  },
  checkSite(ctx) {
    const { site } = ctx;
    const host = siteHost(site);
    // Local/private hosts are never valid, even when they are the detected origin.
    const why = (h: string): string | undefined =>
      isLocalHost(h)
        ? `is on a local/private host (${h})`
        : host !== undefined && h !== host
          ? `is not on ${host}`
          : undefined;
    const found = new Map<string, string>(); // url -> message
    for (const e of sitemapEntries(site)) {
      const w = why(e.host);
      if (w !== undefined && !found.has(e.url))
        found.set(e.url, `${e.url} in sitemap ${w}`);
    }
    for (const url of site.robots?.sitemaps ?? []) {
      if (!URL.canParse(url)) continue;
      const w = why(new URL(url).host.toLowerCase());
      if (w !== undefined) found.set(url, `${url} in robots.txt ${w}`);
    }
    for (const [, message] of [...found].sort(([x], [y]) =>
      x < y ? -1 : x > y ? 1 : 0,
    ))
      ctx.report({ message });
  },
};
