import type { SiteRule } from "../types.js";
import { businessNodes } from "./_helpers.js";

export const rule: SiteRule = {
  meta: {
    id: "schema/business-missing",
    title: "Business structured data missing on home page",
    category: "schema",
    severity: "error",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: true,
    fix: "Add JSON-LD of the configured business schemaType (name, address, telephone) to the home page.",
    source:
      "https://developers.google.com/search/docs/appearance/structured-data/local-business",
  },
  checkSite(ctx) {
    const business = ctx.config.business;
    if (business === undefined) return;
    const home = ctx.site.byKey.get("/");
    if (home === undefined) return;
    if (businessNodes(home, business).length === 0)
      ctx.report({
        message: `Home page has no JSON-LD node of type ${business.schemaType}`,
        url: "/",
        details: { schemaType: business.schemaType },
      });
  },
};
