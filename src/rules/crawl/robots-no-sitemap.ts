import type { SiteRule } from "../types.js";

export const rule: SiteRule = {
  meta: {
    id: "crawl/robots-no-sitemap",
    title: "robots.txt has no Sitemap line",
    category: "crawl",
    severity: "warning",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: false,
    prelaunchExpected: true,
    fix: "Add `Sitemap: https://<domain>/sitemap.xml` to robots.txt.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap",
  },
  checkSite(ctx) {
    const { robots, sitemaps } = ctx.site;
    // Without any sitemap, crawl/sitemap-missing reports the problem.
    if (sitemaps.length === 0) return;
    if (robots !== undefined && robots.sitemaps.length === 0)
      ctx.report({ message: "robots.txt has no Sitemap: line" });
  },
};
