import type { SiteRule } from "../types.js";
import { nodesOf, typesOf } from "./_helpers.js";

const GENERIC = ["LocalBusiness", "Organization"];

export const rule: SiteRule = {
  meta: {
    id: "schema/business-generic-type",
    title: "Generic business type used instead of the specific one",
    category: "schema",
    severity: "warning",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Use the specific schemaType from the config (e.g. Electrician) instead of LocalBusiness or Organization.",
    source: "https://schema.org/LocalBusiness",
  },
  checkSite(ctx) {
    const business = ctx.config.business;
    if (business === undefined || GENERIC.includes(business.schemaType)) return;
    for (const page of ctx.site.pages) {
      const generic = [
        ...new Set(
          nodesOf(page)
            .map(typesOf)
            .filter((t) => !t.includes(business.schemaType))
            .flat()
            .filter((t) => GENERIC.includes(t)),
        ),
      ].sort();
      if (generic.length > 0)
        ctx.report({
          message: `Uses ${generic.join(", ")} while the configured type is ${business.schemaType}`,
          url: page.key,
          details: { found: generic, expected: business.schemaType },
        });
    }
  },
};
