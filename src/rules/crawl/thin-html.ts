import type { PageRule } from "../types.js";

const MIN_WORDS = 30;

export const rule: PageRule = {
  meta: {
    id: "crawl/thin-html",
    title: "Almost no text in HTML",
    category: "crawl",
    severity: "warning",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Render the main content into the HTML at build time instead of in the browser.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics",
  },
  checkPage(page, ctx) {
    if (page.wordCount < MIN_WORDS && /<script\b/i.test(page.html))
      ctx.report({
        message: `${page.key} has ${page.wordCount} words in HTML (min ${MIN_WORDS}) and uses scripts; content may be rendered client-side`,
      });
  },
};
