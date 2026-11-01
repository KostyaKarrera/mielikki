import type { PageRule } from "../types.js";

export const rule: PageRule = {
  meta: {
    id: "schema/jsonld-syntax",
    title: "JSON-LD block is not valid JSON",
    category: "schema",
    severity: "error",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: true,
    fix: "Fix the JSON syntax of the JSON-LD block (commas, quotes, brackets).",
    source:
      "https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data",
  },
  checkPage(page, ctx) {
    page.jsonld.forEach((block, index) => {
      if (block.error !== undefined)
        ctx.report({
          message: `JSON-LD block #${index + 1} cannot be parsed: ${block.error}`,
          details: { index, error: block.error },
        });
    });
  },
};
