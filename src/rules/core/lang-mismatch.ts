import type { PageRule } from "../types.js";

export const rule: PageRule = {
  meta: {
    id: "core/lang-mismatch",
    title: "Page lang differs from the check language",
    category: "core",
    severity: "warning",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Set lang to the language of the page content.",
    source:
      "https://developers.google.com/search/docs/specialty/international/localized-versions",
  },
  checkPage(page, ctx) {
    const lang = page.lang?.trim();
    if (!lang || ctx.lang.code === "other") return;
    const primary = lang.toLowerCase().split(/[-_]/)[0];
    if (primary !== ctx.lang.code)
      ctx.report({
        message: `lang is "${lang}" but the site language is ${ctx.lang.code}`,
      });
  },
};
