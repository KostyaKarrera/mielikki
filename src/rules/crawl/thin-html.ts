import { isIndexable } from "../../model/indexable.js";
import type { PageRule } from "../types.js";

const MIN_WORDS = 30;
/** Script types that never render page content. */
const DATA_TYPES = new Set([
  "application/ld+json",
  "application/json",
  "module",
]);

/** True when the page has a script that could render content client-side. */
function hasRenderingScript(html: string): boolean {
  for (const m of html.matchAll(/<script\b([^>]*)>/gi)) {
    const type = /\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(
      m[1] ?? "",
    );
    const value = (type?.[1] ?? type?.[2] ?? type?.[3] ?? "")
      .trim()
      .toLowerCase();
    if (!DATA_TYPES.has(value)) return true;
  }
  return false;
}

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
    if (page.wordCount >= MIN_WORDS || !isIndexable(ctx.site, page)) return;
    if (hasRenderingScript(page.html))
      ctx.report({
        message: `${page.key} has ${page.wordCount} words in HTML (min ${MIN_WORDS}) and uses scripts; content may be rendered client-side`,
      });
  },
};
