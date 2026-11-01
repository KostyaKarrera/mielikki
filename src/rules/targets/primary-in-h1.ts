import { phraseIn } from "../../lang/match.js";
import type { SiteRule } from "../types.js";
import { resolveTargets } from "./_helpers.js";

export const rule: SiteRule = {
  meta: {
    id: "targets/primary-in-h1",
    title: "Primary query missing from the H1",
    category: "targets",
    severity: "error",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: true,
    fix: "Put the primary query (in any inflected form) into the page's H1.",
    source:
      "https://developers.google.com/search/docs/fundamentals/seo-starter-guide",
  },
  checkSite(ctx) {
    for (const { target, key, page } of resolveTargets(ctx)) {
      if (!page) continue;
      const h1 = page.headings.find((h) => h.level === 1)?.text;
      // A missing H1 is reported by core/h1-missing.
      if (h1 === undefined || h1 === "") continue;
      const level = phraseIn(target.primary, h1, ctx.lang, target.forms);
      if (level === "full") continue;
      ctx.report({
        url: key,
        severity: level === "none" ? "error" : "warning",
        message: `H1 "${h1}" ${level === "none" ? "does not contain" : "only partly contains"} the primary query "${target.primary}"`,
      });
    }
  },
};
