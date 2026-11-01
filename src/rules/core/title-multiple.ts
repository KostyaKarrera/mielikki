import type { PageRule } from "../types.js";

export const rule: PageRule = {
  meta: {
    id: "core/title-multiple",
    title: "Page has several titles",
    category: "core",
    severity: "warning",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Keep exactly one <title> element in the document.",
    source: "https://developers.google.com/search/docs/appearance/title-link",
  },
  checkPage(page, ctx) {
    if (page.titleCount > 1)
      ctx.report({
        message: `${page.key} has ${page.titleCount} <title> elements`,
      });
  },
};
