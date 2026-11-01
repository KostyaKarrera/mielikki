import { isIndexable } from "../../model/indexable.js";
import type { PageRule } from "../types.js";

export const rule: PageRule = {
  meta: {
    id: "core/title-missing",
    title: "Page has no title",
    category: "core",
    severity: "error",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: true,
    fix: "Add a unique, descriptive <title> to the page.",
    source: "https://developers.google.com/search/docs/appearance/title-link",
  },
  checkPage(page, ctx) {
    if (!isIndexable(ctx.site, page)) return;
    if (page.title === undefined || page.title.trim() === "")
      ctx.report({ message: `${page.key} has no title` });
  },
};
