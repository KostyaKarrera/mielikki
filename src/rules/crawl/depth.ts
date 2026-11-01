import { isIndexable } from "../../model/indexable.js";
import type { SiteRule } from "../types.js";

export const rule: SiteRule = {
  meta: {
    id: "crawl/depth",
    title: "Page is too deep in the site",
    category: "crawl",
    severity: "warning",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Link the page from a page closer to the home page.",
    source: "mielikki:original",
    defaultOptions: { maxDepth: 3 },
  },
  checkSite(ctx) {
    const { maxDepth } = ctx.options({ maxDepth: 3 });
    for (const page of ctx.site.pages) {
      const d = ctx.site.depth.get(page.key);
      if (d !== undefined && d > maxDepth && isIndexable(ctx.site, page))
        ctx.report({
          url: page.key,
          message: `${page.key} is ${d} clicks from the home page (max ${maxDepth})`,
        });
    }
  },
};
