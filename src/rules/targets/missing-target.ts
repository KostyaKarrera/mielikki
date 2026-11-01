import { isIndexable } from "../../model/indexable.js";
import { matchPath } from "../glob.js";
import type { SiteRule } from "../types.js";
import { resolveTargets } from "./_helpers.js";

export const rule: SiteRule = {
  meta: {
    id: "targets/missing-target",
    title: "Indexable page has no target query",
    category: "targets",
    severity: "warning",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: true,
    fix: "Add a target (primary query) for this page under targets.pages in the config.",
    source: "mielikki:original",
  },
  checkSite(ctx) {
    const targeted = new Set(resolveTargets(ctx).map((t) => t.key));
    const { required } = ctx.config.targets;
    for (const page of ctx.site.pages) {
      if (targeted.has(page.key) || !isIndexable(ctx.site, page)) continue;
      const isRequired = required.some((m) => matchPath(m, page.key));
      ctx.report({
        url: page.key,
        severity: isRequired ? "warning" : "info",
        message: `Indexable page ${page.key} has no target query`,
      });
    }
  },
};
