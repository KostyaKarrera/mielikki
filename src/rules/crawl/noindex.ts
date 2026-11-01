import { matchPath } from "../glob.js";
import { isTargetPage } from "../targets/_helpers.js";
import type { PageRule } from "../types.js";

export const rule: PageRule = {
  meta: {
    id: "crawl/noindex",
    title: "Page has noindex",
    category: "crawl",
    severity: "error",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: true,
    prelaunchExpected: true,
    fix: "Remove the noindex robots meta, or list the page under exclude.noindexExpected.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/block-indexing",
  },
  checkPage(page, ctx) {
    if (!page.robotsMeta.includes("noindex")) return;
    if (isTargetPage(ctx.config, page.key)) return; // targets/not-indexable reports it
    if (ctx.config.exclude.noindexExpected.some((p) => matchPath(p, page.key)))
      return;
    ctx.report({ message: `${page.key} has noindex but is not expected to` });
  },
};
