import type { SiteRule } from "../types.js";

const MAX_LISTED = 50;

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
    const n = crawl.skipped.length;
    ctx.report({
      nonBlocking: true,
      message: `The page limit was reached; ${n} discovered URL(s) were not checked, and links or targets on pages not crawled are not reported${n > MAX_LISTED ? ` (first ${MAX_LISTED} listed)` : ""}`,
      details: { skipped: crawl.skipped.slice(0, MAX_LISTED) },
    });
  },
};
