import type { SiteRule } from "../types.js";
import { resolveTargets } from "./_helpers.js";

export const rule: SiteRule = {
  meta: {
    id: "targets/page-missing",
    title: "Target page does not exist",
    category: "targets",
    severity: "error",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: true,
    fix: "Create the page for this target or correct the target url in the config.",
    source: "mielikki:original",
  },
  checkSite(ctx) {
    for (const { target, key, page } of resolveTargets(ctx))
      if (!page)
        ctx.report({
          url: key,
          message: `No page found for target ${key} (primary "${target.primary}")`,
        });
  },
};
