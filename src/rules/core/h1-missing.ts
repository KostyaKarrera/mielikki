import type { PageRule } from "../types.js";

export const rule: PageRule = {
  meta: {
    id: "core/h1-missing",
    title: "Page has no H1",
    category: "core",
    severity: "error",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: true,
    fix: "Add one H1 that describes the page.",
    source:
      "https://developers.google.com/search/docs/fundamentals/seo-starter-guide",
  },
  checkPage(page, ctx) {
    if (!page.headings.some((h) => h.level === 1))
      ctx.report({ message: `${page.key} has no H1` });
  },
};
