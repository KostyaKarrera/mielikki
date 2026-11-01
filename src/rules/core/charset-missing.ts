import type { PageRule } from "../types.js";

export const rule: PageRule = {
  meta: {
    id: "core/charset-missing",
    title: "Page declares no charset",
    category: "core",
    severity: "info",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Add a UTF-8 charset meta early in <head>.",
    source: "mielikki:original",
  },
  checkPage(page, ctx) {
    if (page.charset === undefined || page.charset.trim() === "")
      ctx.report({ message: `${page.key} declares no charset` });
  },
};
