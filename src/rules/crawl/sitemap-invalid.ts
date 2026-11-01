import type { SiteRule } from "../types.js";

export const rule: SiteRule = {
  meta: {
    id: "crawl/sitemap-invalid",
    title: "Sitemap is invalid or empty",
    category: "crawl",
    severity: "error",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: true,
    fix: "Fix the sitemap XML so it parses and lists at least one URL.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap",
  },
  checkSite(ctx) {
    for (const sm of ctx.site.sitemaps) {
      if (!sm.ok)
        ctx.report({
          url: sm.file,
          message: `Sitemap ${sm.file} is invalid: ${sm.error ?? "unknown error"}`,
        });
      else if (sm.urls.length === 0)
        ctx.report({
          url: sm.file,
          message: `Sitemap ${sm.file} lists 0 URLs`,
        });
    }
  },
};
