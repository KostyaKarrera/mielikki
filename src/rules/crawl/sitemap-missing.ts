import type { SiteRule } from "../types.js";

export const rule: SiteRule = {
  meta: {
    id: "crawl/sitemap-missing",
    title: "No sitemap found",
    category: "crawl",
    severity: "error",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: true,
    prelaunchExpected: true,
    fix: "Generate a sitemap.xml listing all indexable pages.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview",
  },
  checkSite(ctx) {
    if (ctx.site.sitemaps.length === 0)
      ctx.report({ message: "No sitemap found" });
  },
};
