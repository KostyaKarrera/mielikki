import { isIndexable } from "../../model/indexable.js";
import type { PageRule } from "../types.js";

export const rule: PageRule = {
  meta: {
    id: "core/description-missing",
    title: "Page has no meta description",
    category: "core",
    severity: "warning",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Add a meta description that summarises the page.",
    source: "https://developers.google.com/search/docs/appearance/snippet",
  },
  checkPage(page, ctx) {
    if (!isIndexable(ctx.site, page)) return;
    if (
      page.metaDescription === undefined ||
      page.metaDescription.trim() === ""
    )
      ctx.report({ message: `${page.key} has no meta description` });
  },
};
