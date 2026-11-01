import { isIndexable } from "../../model/indexable.js";
import type { SiteRule } from "../types.js";
import { ownPageEntries } from "./_helpers.js";

export const rule: SiteRule = {
  meta: {
    id: "crawl/sitemap-missing-page",
    title: "Indexable page missing from sitemap",
    category: "crawl",
    severity: "warning",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Add the page to the sitemap, or mark it noindex if it should stay out of search.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview",
  },
  checkSite(ctx) {
    const { site } = ctx;
    const entries = ownPageEntries(site);
    if (entries.length === 0) return; // no usable sitemap: other rules cover it
    const listed = new Set(entries.map((e) => e.key));
    for (const page of site.pages)
      if (isIndexable(site, page) && !listed.has(page.key))
        ctx.report({
          url: page.key,
          message: `${page.key} is indexable but not in the sitemap`,
        });
  },
};
