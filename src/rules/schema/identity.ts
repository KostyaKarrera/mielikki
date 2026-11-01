import type { SiteRule } from "../types.js";
import { businessNodes, normalizeName, str } from "./_helpers.js";

export const rule: SiteRule = {
  meta: {
    id: "schema/identity",
    title: "Business identity differs between pages",
    category: "schema",
    severity: "warning",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Use the same @id and name for the business node on every page.",
    source: "https://schema.org/docs/datamodel.html",
  },
  checkSite(ctx) {
    const business = ctx.config.business;
    if (business === undefined) return;
    const ids = new Map<string, string>();
    const names = new Map<string, string>();
    for (const page of ctx.site.pages) {
      for (const node of businessNodes(page, business)) {
        const id = str(node["@id"]);
        if (id !== undefined && !ids.has(id)) ids.set(id, page.key);
        const name = str(node.name);
        if (name !== undefined && !names.has(normalizeName(name)))
          names.set(normalizeName(name), page.key);
      }
    }
    for (const [field, seen] of [
      ["@id", ids],
      ["name", names],
    ] as const) {
      if (seen.size > 1)
        ctx.report({
          message: `Business nodes use ${seen.size} different ${field} values: ${[...seen.keys()].sort().join(", ")}`,
          url: [...seen.values()].sort()[0],
          details: { field, values: [...seen.keys()].sort() },
        });
    }
  },
};
