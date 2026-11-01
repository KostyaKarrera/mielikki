import type { SiteRule } from "../types.js";
import { businessNodes } from "./_helpers.js";

export const rule: SiteRule = {
  meta: {
    id: "schema/area-served",
    title: "Service-area business has no areaServed",
    category: "schema",
    severity: "warning",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Add areaServed (cities or regions) to the business JSON-LD node.",
    source:
      "https://developers.google.com/search/docs/appearance/structured-data/local-business",
  },
  checkSite(ctx) {
    const business = ctx.config.business;
    if (business === undefined || business.type === "brick-and-mortar") return;
    let first: string | undefined;
    for (const page of ctx.site.pages) {
      const nodes = businessNodes(page, business);
      if (nodes.some((n) => n.areaServed !== undefined)) return;
      if (first === undefined && nodes.length > 0) first = page.key;
    }
    if (first !== undefined)
      ctx.report({
        message: `Business type is ${business.type} but no ${business.schemaType} node has areaServed`,
        url: first,
      });
  },
};
