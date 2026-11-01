import { isIndexable } from "../../model/indexable.js";
import type { PageRule } from "../types.js";

export const rule: PageRule = {
  meta: {
    id: "core/canonical-missing",
    title: "Indexable page has no canonical",
    category: "core",
    severity: "warning",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Add a self-referencing rel=canonical link.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls",
  },
  checkPage(page, ctx) {
    if (!isIndexable(ctx.site, page)) return;
    if (page.canonical === undefined || page.canonical.trim() === "")
      ctx.report({ message: `${page.key} has no canonical link` });
  },
};
