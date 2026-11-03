import { MAX_NESTING } from "../../parse/depth.js";
import type { SiteRule } from "../types.js";

export const rule: SiteRule = {
  meta: {
    id: "crawl/page-too-deep",
    title: "Page nesting is too deep to be parsed within safe limits",
    category: "crawl",
    severity: "error",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: true,
    fix: `Reduce the HTML element nesting (more than ${MAX_NESTING} levels deep, and the parser gave up within its time or memory limit); the page was skipped and none of its other problems are reported.`,
    source: "mielikki:original",
  },
  checkSite(ctx) {
    for (const p of ctx.site.unparsed ?? [])
      if (p.reason === "too-deep")
        ctx.report({
          url: p.url,
          message: `${p.url} was not analyzed: the parser gave up on the page; page too deeply nested (${p.depth} > ${MAX_NESTING})`,
        });
  },
};
