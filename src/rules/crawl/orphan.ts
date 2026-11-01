import { isIndexable } from "../../model/indexable.js";
import type { SiteRule } from "../types.js";

export const rule: SiteRule = {
  meta: {
    id: "crawl/orphan",
    title: "Page has no internal links",
    category: "crawl",
    severity: "warning",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Link to the page from navigation or related pages.",
    source: "mielikki:original",
  },
  checkSite(ctx) {
    const { site } = ctx;
    for (const page of site.pages)
      if (
        page.key !== "/" &&
        isIndexable(site, page) &&
        (site.inlinksAll.get(page.key)?.length ?? 0) === 0
      )
        ctx.report({
          url: page.key,
          message: `${page.key} has no internal links pointing to it`,
        });
  },
};
