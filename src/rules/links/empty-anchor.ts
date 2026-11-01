import type { PageRule } from "../types.js";

export const rule: PageRule = {
  meta: {
    id: "links/empty-anchor",
    title: "Link has no accessible text",
    category: "links",
    severity: "warning",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Add link text, an aria-label, or alt text on the image inside the link.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/links-crawlable",
  },
  checkPage(page, ctx) {
    for (const l of page.links)
      if (l.text === "" && l.label === undefined)
        ctx.report({
          message: `Link to "${l.href}" has no text, aria-label or image alt`,
        });
  },
};
