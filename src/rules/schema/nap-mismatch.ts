import type { SiteRule } from "../types.js";
import {
  businessNodes,
  normalizeName,
  normalizePhone,
  str,
} from "./_helpers.js";

export const rule: SiteRule = {
  meta: {
    id: "schema/nap-mismatch",
    title: "Structured data name or phone differs from the config",
    category: "schema",
    severity: "error",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: true,
    fix: "Make name and telephone in the JSON-LD identical to the business data in the config.",
    source:
      "https://developers.google.com/search/docs/appearance/structured-data/local-business",
  },
  checkSite(ctx) {
    const business = ctx.config.business;
    if (business === undefined) return;
    for (const page of ctx.site.pages) {
      for (const node of businessNodes(page, business)) {
        const name = str(node.name);
        if (
          name !== undefined &&
          normalizeName(name) !== normalizeName(business.name)
        )
          ctx.report({
            message: `name "${name}" differs from configured "${business.name}"`,
            url: page.key,
            details: { field: "name", found: name, expected: business.name },
          });
        const phone = str(node.telephone);
        if (
          phone !== undefined &&
          business.phone !== undefined &&
          normalizePhone(phone) !== normalizePhone(business.phone)
        )
          ctx.report({
            message: `telephone "${phone}" differs from configured "${business.phone}"`,
            url: page.key,
            details: {
              field: "telephone",
              found: phone,
              expected: business.phone,
            },
          });
      }
    }
  },
};
