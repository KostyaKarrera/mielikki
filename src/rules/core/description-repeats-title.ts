import { isIndexable } from "../../model/indexable.js";
import type { PageRule } from "../types.js";

export const rule: PageRule = {
  meta: {
    id: "core/description-repeats-title",
    title: "Description repeats the title",
    category: "core",
    severity: "info",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Write a description that adds information beyond the title.",
    source: "https://developers.google.com/search/docs/appearance/snippet",
  },
  checkPage(page, ctx) {
    if (!isIndexable(ctx.site, page)) return;
    const title = page.title?.trim().toLowerCase();
    const desc = page.metaDescription?.trim().toLowerCase();
    if (!title || !desc) return;
    if (desc.startsWith(title))
      ctx.report({ message: "Description starts with the page title" });
  },
};
