import { phraseIn } from "../../lang/match.js";
import type { SiteRule } from "../types.js";
import { resolveTargets } from "./_helpers.js";

export const rule: SiteRule = {
  meta: {
    id: "targets/secondary-in-text",
    title: "Secondary query missing from the text",
    category: "targets",
    severity: "info",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Work the secondary query naturally into the page text.",
    source: "mielikki:original",
  },
  checkSite(ctx) {
    for (const { target, key, page } of resolveTargets(ctx)) {
      if (!page) continue;
      for (const phrase of target.secondary)
        if (phraseIn(phrase, page.mainText, ctx.lang, target.forms) === "none")
          ctx.report({
            url: key,
            message: `Secondary query "${phrase}" does not appear in the text of ${key}`,
            details: { phrase },
          });
    }
  },
};
