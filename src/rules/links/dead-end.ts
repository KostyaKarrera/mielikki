import { isIndexable } from "../../model/indexable.js";
import type { SiteRule } from "../types.js";
import { navigableInternal } from "./_helpers.js";

export const rule: SiteRule = {
  meta: {
    id: "links/dead-end",
    title: "Page has no outgoing internal links",
    category: "links",
    severity: "info",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Add internal links in the content to related pages.",
    source: "squirrelscan:links/dead-end-pages",
  },
  checkSite(ctx) {
    const { site } = ctx;
    for (const page of site.pages) {
      if (!isIndexable(site, page)) continue;
      const out = navigableInternal(page.links).some(
        (l) => !l.inChrome && l.key !== page.key,
      );
      if (!out)
        ctx.report({
          url: page.key,
          message: `${page.key} has no internal links in its content`,
        });
    }
  },
};
