import { phraseIn } from "../../lang/match.js";
import type { SiteRule } from "../types.js";
import { resolveTargets } from "./_helpers.js";

export const rule: SiteRule = {
  meta: {
    id: "targets/primary-in-description",
    title: "Primary query missing from the description",
    category: "targets",
    severity: "warning",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Mention the primary query in the meta description.",
    source: "https://developers.google.com/search/docs/appearance/snippet",
  },
  checkSite(ctx) {
    for (const { target, key, page } of resolveTargets(ctx)) {
      if (!page) continue;
      const text = page.metaDescription;
      // A missing element is not this rule's concern (core/description-missing, content/word-count).
      if (text === undefined || text.trim() === "") continue;
      if (phraseIn(target.primary, text, ctx.lang, target.forms) === "none")
        ctx.report({
          url: key,
          message: `Meta description does not contain the primary query "${target.primary}"`,
        });
    }
  },
};
