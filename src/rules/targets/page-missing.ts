import { isCrawled, keyUrl, reachOfUrls } from "../_reach.js";
import type { SiteRule } from "../types.js";
import { resolveTargets } from "./_helpers.js";

export const rule: SiteRule = {
  meta: {
    id: "targets/page-missing",
    title: "Target page does not exist",
    category: "targets",
    severity: "error",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: true,
    fix: "Create the page for this target or correct the target url in the config.",
    source: "mielikki:original",
  },
  checkSite(ctx) {
    const { site } = ctx;
    for (const { target, key, page } of resolveTargets(ctx)) {
      if (page) continue;
      if (isCrawled(site)) {
        // URL mode: a target the crawl never requested is only missing when the
        // crawl was complete; after the page limit or a robots/query skip it is
        // unknown (http/crawl-limit reports the limit).
        const url = keyUrl(site.origin, key);
        const unrequested =
          reachOfUrls(site, [url]).state === "unknown" &&
          (site.crawl?.limitReached === true ||
            site.crawl?.skipped.includes(url) === true);
        if (unrequested) continue;
      }
      ctx.report({
        url: key,
        message: `No page found for target ${key} (primary "${target.primary}")`,
      });
    }
  },
};
