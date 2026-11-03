import { MAX_NESTING } from "../../parse/depth.js";
import type { SiteRule } from "../types.js";

export const rule: SiteRule = {
  meta: {
    id: "crawl/page-too-deep",
    title: "Page is nested too deeply to be analyzed",
    category: "crawl",
    severity: "error",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: true,
    fix: `Reduce the HTML element nesting (limit ${MAX_NESTING}); the page was skipped and none of its other problems are reported.`,
    source: "mielikki:original",
  },
  checkSite(ctx) {
    for (const p of ctx.site.unparsed ?? [])
      ctx.report({
        url: p.url,
        message: `${p.url} was not analyzed: page too deeply nested (${p.depth} > ${MAX_NESTING})`,
      });
  },
};
