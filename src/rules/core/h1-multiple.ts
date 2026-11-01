import type { PageRule } from "../types.js";

export const rule: PageRule = {
  meta: {
    id: "core/h1-multiple",
    title: "Page has several H1s",
    category: "core",
    severity: "warning",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Keep a single H1 and demote the others.",
    source:
      "https://developers.google.com/search/docs/fundamentals/seo-starter-guide",
  },
  checkPage(page, ctx) {
    const n = page.headings.filter((h) => h.level === 1).length;
    if (n > 1) ctx.report({ message: `${page.key} has ${n} H1 headings` });
  },
};
