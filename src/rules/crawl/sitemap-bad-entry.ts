import { isIndexable } from "../../model/indexable.js";
import type { SiteRule } from "../types.js";
import { ownPageEntries } from "./_helpers.js";

export const rule: SiteRule = {
  meta: {
    id: "crawl/sitemap-bad-entry",
    title: "Sitemap lists a non-indexable URL",
    category: "crawl",
    severity: "warning",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Remove the URL from the sitemap, or make the page indexable and canonical to itself.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap",
  },
  checkSite(ctx) {
    const { site } = ctx;
    const seen = new Set<string>();
    for (const e of ownPageEntries(site)) {
      if (seen.has(e.key)) continue;
      seen.add(e.key);
      if (site.assets.has(e.key)) continue;
      const page = site.byKey.get(e.key);
      if (page === undefined)
        ctx.report({
          url: e.key,
          message: `Sitemap URL ${e.url} has no page in the site`,
        });
      else if (!isIndexable(site, page)) {
        const why =
          page.canonical !== undefined && page.canonical.trim() !== ""
            ? "is noindex, blocked, excluded or canonical to another URL"
            : "is not indexable (noindex, blocked or excluded)";
        ctx.report({ url: e.key, message: `Sitemap URL ${e.url} ${why}` });
      }
    }
  },
};
