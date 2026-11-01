import type { SiteRule } from "../types.js";

export const rule: SiteRule = {
  meta: {
    id: "crawl/robots-missing",
    title: "robots.txt is missing",
    category: "crawl",
    severity: "error",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: true,
    prelaunchExpected: true,
    fix: "Add a /robots.txt that allows crawling and lists the sitemap.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/robots/intro",
  },
  checkSite(ctx) {
    if (ctx.site.robots === undefined)
      ctx.report({ message: "No /robots.txt found" });
  },
};
