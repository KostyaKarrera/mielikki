import { phraseIn } from "../../lang/match.js";
import type { SiteRule } from "../types.js";
import { resolveTargets } from "./_helpers.js";

export const rule: SiteRule = {
  meta: {
    id: "targets/primary-in-title",
    title: "Primary query missing from the title",
    category: "targets",
    severity: "error",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: true,
    fix: "Put the primary query (in any inflected form) into the page title.",
    source: "https://developers.google.com/search/docs/appearance/title-link",
  },
  checkSite(ctx) {
    for (const { target, key, page } of resolveTargets(ctx)) {
      if (!page) continue;
      const level = phraseIn(
        target.primary,
        page.title ?? "",
        ctx.lang,
        target.forms,
      );
      if (level === "full") continue;
      ctx.report({
        url: key,
        severity: level === "none" ? "error" : "warning",
        message:
          page.title === undefined
            ? `Title is missing; primary query "${target.primary}" is not covered`
            : `Title "${page.title}" ${level === "none" ? "does not contain" : "only partly contains"} the primary query "${target.primary}"`,
      });
    }
  },
};
