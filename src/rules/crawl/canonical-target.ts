import { isIndexable } from "../../model/indexable.js";
import { resolveHref } from "../../model/url.js";
import { isTargetPage } from "../targets/_helpers.js";
import type { PageRule } from "../types.js";

export const rule: PageRule = {
  meta: {
    id: "crawl/canonical-target",
    title: "Canonical points to a bad internal URL",
    category: "crawl",
    severity: "error",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: true,
    fix: "Point the canonical at an existing, indexable page (or at the page itself).",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls",
  },
  checkPage(page, ctx) {
    const { site } = ctx;
    if (page.canonical === undefined || page.canonical.trim() === "") return;
    if (isTargetPage(ctx.config, page.key)) return; // targets/not-indexable reports it
    const target = resolveHref(page.canonical, page.key, site.site);
    if (!target.internal || target.key === undefined || target.key === page.key)
      return;
    const targetPage = site.byKey.get(target.key);
    if (targetPage === undefined)
      ctx.report({
        message: `Canonical ${page.canonical} points to ${target.key}, which does not exist`,
      });
    else if (!isIndexable(site, targetPage))
      ctx.report({
        message: `Canonical ${page.canonical} points to ${target.key}, which is not indexable`,
      });
  },
};
