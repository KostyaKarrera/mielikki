import { isIndexable } from "../../model/indexable.js";
import type { PageRule } from "../types.js";
import { tag } from "./_helpers.js";

export const rule: PageRule = {
  meta: {
    id: "social/twitter-card",
    title: "twitter:card is missing",
    category: "social",
    severity: "info",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: 'Add <meta name="twitter:card" content="summary_large_image">.',
    source: "mielikki:original",
  },
  checkPage(page, ctx) {
    if (
      isIndexable(ctx.site, page) &&
      tag(page.twitter, "twitter:card") === undefined
    )
      ctx.report({ message: "No twitter:card meta tag" });
  },
};
