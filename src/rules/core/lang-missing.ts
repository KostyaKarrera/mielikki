import type { PageRule } from "../types.js";

export const rule: PageRule = {
  meta: {
    id: "core/lang-missing",
    title: "Page has no lang attribute",
    category: "core",
    severity: "warning",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Set the lang attribute on <html>.",
    source:
      "https://developers.google.com/search/docs/specialty/international/localized-versions",
  },
  checkPage(page, ctx) {
    if (page.lang === undefined || page.lang.trim() === "")
      ctx.report({ message: `${page.key} has no lang attribute` });
  },
};
