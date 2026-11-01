import { phraseIn } from "../../lang/match.js";
import type { SiteRule } from "../types.js";
import { resolveTargets } from "./_helpers.js";

export const rule: SiteRule = {
  meta: {
    id: "targets/primary-in-intro",
    title: "Primary query missing from the intro",
    category: "targets",
    severity: "warning",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Mention the primary query in the first paragraph of the page.",
    source: "mielikki:original",
  },
  checkSite(ctx) {
    for (const { target, key, page } of resolveTargets(ctx)) {
      if (!page) continue;
      const text = page.firstParagraph;
      if (text === undefined || text.trim() === "") {
        ctx.report({
          url: key,
          message: `First paragraph is missing on ${key}; primary query "${target.primary}" is not covered`,
        });
        continue;
      }
      if (phraseIn(target.primary, text, ctx.lang, target.forms) === "none")
        ctx.report({
          url: key,
          message: `First paragraph does not contain the primary query "${target.primary}"`,
        });
    }
  },
};
