import type { SiteRule } from "../types.js";

export const rule: SiteRule = {
  meta: {
    id: "crawl/robots-blocks-all",
    title: "robots.txt blocks the whole site",
    category: "crawl",
    severity: "error",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: true,
    prelaunchExpected: true,
    fix: "Remove the blanket `Disallow: /` for Googlebot before launch.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/robots/intro",
  },
  checkSite(ctx) {
    if (ctx.site.robots?.disallowsAll("Googlebot"))
      ctx.report({
        message: "robots.txt disallows the whole site for Googlebot",
      });
  },
};
