import type { PageRule } from "../types.js";
import { navigableInternal, reportedByTrailingSlash } from "./_helpers.js";

export const rule: PageRule = {
  meta: {
    id: "links/trailing-slash",
    title: "Link contradicts trailing-slash policy",
    category: "links",
    severity: "info",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Make internal links follow the input.trailingSlash setting.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls",
  },
  checkPage(page, ctx) {
    const policy = ctx.config.input.trailingSlash;
    if (policy !== "always" && policy !== "never") return;
    const seen = new Set<string>();
    for (const l of navigableInternal(page.links)) {
      if (
        !reportedByTrailingSlash(l, policy, ctx.site.assets) ||
        seen.has(l.href)
      )
        continue;
      seen.add(l.href);
      ctx.report({
        message: `Link "${l.href}" ${policy === "never" ? "has" : "lacks"} a trailing slash (trailingSlash: ${policy})`,
      });
    }
  },
};
