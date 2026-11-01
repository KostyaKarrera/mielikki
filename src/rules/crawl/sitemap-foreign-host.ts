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
    if (host === undefined) return;
    const foreign = new Map<string, string>(); // url -> where it was found
    for (const e of sitemapEntries(site))
      if (e.host !== host && !foreign.has(e.url)) foreign.set(e.url, "sitemap");
    for (const url of site.robots?.sitemaps ?? [])
      if (URL.canParse(url) && new URL(url).host.toLowerCase() !== host)
        foreign.set(url, "robots.txt");
    for (const [url, where] of [...foreign].sort(([x], [y]) =>
      x < y ? -1 : 1,
    ))
      ctx.report({
        message: `${url} in ${where} is not on ${host}`,
      });
  },
};
