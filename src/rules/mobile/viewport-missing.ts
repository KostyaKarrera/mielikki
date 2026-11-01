import type { PageRule } from "../types.js";

export const rule: PageRule = {
  meta: {
    id: "mobile/viewport-missing",
    title: "Page has no viewport meta",
    category: "mobile",
    severity: "warning",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Add a viewport meta with width=device-width, initial-scale=1.",
    source:
      "https://developers.google.com/search/mobile-sites/mobile-first-indexing",
  },
  checkPage(page, ctx) {
    if (page.viewport === undefined || page.viewport.trim() === "")
      ctx.report({ message: `${page.key} has no viewport meta` });
  },
};
