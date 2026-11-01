import { isIndexable, isRobotsAllowed } from "../../model/indexable.js";
import { isTargetPage } from "../targets/_helpers.js";
import type { SiteRule } from "../types.js";

export const rule: SiteRule = {
  meta: {
    id: "crawl/robots-blocks-page",
    title: "robots.txt blocks an indexable page",
    category: "crawl",
    severity: "error",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: true,
    prelaunchExpected: true,
    fix: "Remove the matching Disallow rule, or mark the page noindex on purpose.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/robots/intro",
  },
  checkSite(ctx) {
    const { site } = ctx;
    if (site.robots === undefined || site.robots.disallowsAll("Googlebot"))
      return;
    // Indexability judged without robots, so a blocked page still counts as wanted.
    const withoutRobots = { ...site, robots: undefined };
    for (const page of site.pages) {
      if (isTargetPage(ctx.config, page.key)) continue; // targets/not-indexable reports it
      if (isIndexable(withoutRobots, page) && !isRobotsAllowed(site, page.key))
        ctx.report({
          url: page.key,
          message: `${page.key} is blocked for Googlebot by robots.txt`,
        });
    }
  },
};
