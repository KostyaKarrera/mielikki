import type { PageRule } from "../types.js";

export const rule: PageRule = {
  meta: {
    id: "links/generic-anchor",
    title: "Link text is generic",
    category: "links",
    severity: "info",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Use descriptive link text that says where the link leads.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/links-crawlable",
  },
  checkPage(page, ctx) {
    const generic = new Set(ctx.lang.genericAnchors);
    for (const l of page.links) {
      const text = l.text
        .toLowerCase()
        .replace(/[\s\p{P}\p{S}]+$/u, "")
        .trim();
      if (text !== "" && generic.has(text))
        ctx.report({
          message: `Link to "${l.href}" uses generic text "${l.text}"`,
        });
    }
  },
};
