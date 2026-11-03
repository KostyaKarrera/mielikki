import { isCrawled, linkReach, pageBase } from "../_reach.js";
import type { PageRule } from "../types.js";
import { navigableInternal } from "./_helpers.js";

export const rule: PageRule = {
  meta: {
    id: "links/broken-internal",
    title: "Internal link is broken",
    category: "links",
    severity: "error",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: true,
    fix: "Fix the link target or restore the missing page or file.",
    source: "squirrelscan:links/broken-links",
  },
  checkPage(page, ctx) {
    const { site } = ctx;
    const seen = new Set<string>();
    for (const l of navigableInternal(page.links)) {
      const key = l.key as string;
      if (seen.has(key)) continue;
      let why = "does not exist";
      if (isCrawled(site)) {
        // URL mode: only what was requested and failed is broken; a URL that was
        // not requested (page limit, asset budget, query, robots) is unknown.
        const reach = linkReach(site, l.href, pageBase(site, page), key);
        if (reach.state !== "broken") continue;
        why = reach.reason;
      } else if (site.byKey.has(key) || site.assets.has(key)) continue;
      seen.add(key);
      ctx.report({
        message: `Link "${l.href}" points to ${key}, which ${why}`,
      });
    }
  },
};
