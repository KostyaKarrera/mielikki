import { isIndexable } from "../../model/indexable.js";
import type { PageRule } from "../types.js";

export const rule: PageRule = {
  meta: {
    id: "core/title-length",
    title: "Title length is out of range",
    category: "core",
    severity: "warning",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    defaultOptions: { min: 30, max: 60 },
    fix: "Rewrite the title to fit the recommended length.",
    source: "https://developers.google.com/search/docs/appearance/title-link",
  },
  checkPage(page, ctx) {
    if (!isIndexable(ctx.site, page)) return;
    const title = page.title?.trim();
    if (title === undefined || title === "") return;
    const { min, max } = ctx.options({ min: 30, max: 60 });
    const length = [...title].length;
    if (length < min || length > max)
      ctx.report({
        message: `Title is ${length} chars (${length < min ? `min ${min}` : `max ${max}`})`,
        details: { length, min, max },
      });
  },
};
