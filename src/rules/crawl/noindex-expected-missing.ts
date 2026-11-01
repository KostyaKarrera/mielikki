import { matchPath } from "../glob.js";
import type { PageRule } from "../types.js";

export const rule: PageRule = {
  meta: {
    id: "crawl/noindex-expected-missing",
    title: "Page expected to be noindex is indexable",
    category: "crawl",
    severity: "warning",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: 'Add `<meta name="robots" content="noindex">` to the page, or remove it from exclude.noindexExpected.',
    source:
      "https://developers.google.com/search/docs/crawling-indexing/block-indexing",
  },
  checkPage(page, ctx) {
    if (!ctx.config.exclude.noindexExpected.some((p) => matchPath(p, page.key)))
      return;
    if (!page.robotsMeta.includes("noindex"))
      ctx.report({
        message: `${page.key} is listed in exclude.noindexExpected but has no noindex`,
      });
  },
};
