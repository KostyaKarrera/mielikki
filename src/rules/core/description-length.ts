import { isIndexable } from "../../model/indexable.js";
import type { PageRule } from "../types.js";

export const rule: PageRule = {
  meta: {
    id: "core/description-length",
    title: "Description length is out of range",
    category: "core",
    severity: "info",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    defaultOptions: { min: 120, max: 160 },
    fix: "Rewrite the description to fit the recommended length.",
    source: "https://developers.google.com/search/docs/appearance/snippet",
  },
  checkPage(page, ctx) {
    if (!isIndexable(ctx.site, page)) return;
    const desc = page.metaDescription?.trim();
    if (desc === undefined || desc === "") return;
    const { min, max } = ctx.options({ min: 120, max: 160 });
    const length = [...desc].length;
    if (length < min || length > max)
      ctx.report({
        message: `Description is ${length} chars (${length < min ? `min ${min}` : `max ${max}`})`,
        details: { length, min, max },
      });
  },
};
