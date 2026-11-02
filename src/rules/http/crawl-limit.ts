import type { SiteRule } from "../types.js";

export const rule: SiteRule = {
  meta: {
    id: "http/crawl-limit",
    title: "Crawl stopped at the page limit",
    category: "http",
    severity: "info",
    scope: "site",
    inputs: ["url"],
    launchBlocking: false,
    fix: "Raise the page limit (--max-pages) to check the whole site.",
    source: "squirrelscan:crawl/limit",
  },
  checkSite(ctx) {
    const crawl = ctx.site.crawl;
    if (crawl === undefined || !crawl.limitReached) return;
    ctx.report({
      nonBlocking: true,
      message: `The page limit was reached; ${crawl.skipped.length} URL(s) were not checked${crawl.skipped.length >= 50 ? " (list truncated)" : ""}`,
      details: { skipped: crawl.skipped },
    });
  },
};
