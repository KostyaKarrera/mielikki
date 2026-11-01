import type { PageRule } from "../types.js";
import { nodesOf, typesOf } from "./_helpers.js";

const NOTES: Record<string, string> = {
  HowTo: "Google no longer shows HowTo rich results",
  FAQPage:
    "Google no longer shows FAQ rich results for most sites, but the markup is still allowed",
};

export const rule: PageRule = {
  meta: {
    id: "schema/deprecated",
    title: "Structured data type without rich results",
    category: "schema",
    severity: "info",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Keep the markup only if it describes real content; do not expect rich results from it.",
    source:
      "https://developers.google.com/search/updates/faqpage-howto-changes",
  },
  checkPage(page, ctx) {
    const types = new Set(nodesOf(page).flatMap(typesOf));
    for (const type of Object.keys(NOTES).sort())
      if (types.has(type))
        ctx.report({
          message: `${type}: ${NOTES[type]}`,
          details: { type },
        });
  },
};
