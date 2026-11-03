import type { SiteRule } from "../types.js";

export const rule: SiteRule = {
  meta: {
    id: "crawl/page-unparseable",
    title: "Page could not be parsed safely",
    category: "crawl",
    severity: "error",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: true,
    fix: "Simplify the HTML (broken or pathological markup made the parser time out, run out of memory or overflow its stack); the page was skipped and none of its other problems are reported.",
    source: "mielikki:original",
  },
  checkSite(ctx) {
    for (const p of ctx.site.unparsed ?? [])
      if (p.reason !== "too-deep")
        ctx.report({
          url: p.url,
          message: `${p.url} was not analyzed: the page could not be parsed safely (${p.reason})`,
        });
  },
};
