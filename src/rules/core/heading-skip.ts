import type { PageRule } from "../types.js";

export const rule: PageRule = {
  meta: {
    id: "core/heading-skip",
    title: "Heading level is skipped",
    category: "core",
    severity: "info",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Do not skip heading levels (for example H2 to H4).",
    source:
      "https://developers.google.com/search/docs/fundamentals/seo-starter-guide",
  },
  checkPage(page, ctx) {
    let prev = 0;
    for (const h of page.headings) {
      if (prev > 0 && h.level > prev + 1)
        ctx.report({
          message: `Heading jumps from H${prev} to H${h.level} ("${h.text}")`,
        });
      prev = h.level;
    }
  },
};
