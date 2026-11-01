import { isRobotsAllowed } from "../../model/indexable.js";
import { resolveHref } from "../../model/url.js";
import type { SiteRule } from "../types.js";
import { resolveTargets } from "./_helpers.js";

export const rule: SiteRule = {
  meta: {
    id: "targets/not-indexable",
    title: "Target page cannot be indexed",
    category: "targets",
    severity: "error",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: true,
    prelaunchExpected: true,
    fix: "Remove noindex, the robots.txt Disallow or the foreign canonical from the target page.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/block-indexing",
  },
  checkSite(ctx) {
    for (const { key, page } of resolveTargets(ctx)) {
      if (!page) continue;
      const reasons: string[] = [];
      if (page.robotsMeta.includes("noindex")) reasons.push("noindex meta");
      if (!isRobotsAllowed(ctx.site, key))
        reasons.push("disallowed in robots.txt");
      const canonical = page.canonical?.trim();
      if (canonical) {
        const t = resolveHref(canonical, key, ctx.site.site);
        if (!t.internal || t.key !== key)
          reasons.push(`canonical points to ${canonical}`);
      }
      if (reasons.length > 0)
        ctx.report({
          url: key,
          message: `Target page ${key} cannot be indexed: ${reasons.join(", ")}`,
          details: { reasons },
        });
    }
  },
};
