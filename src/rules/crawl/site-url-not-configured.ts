import type { SiteRule } from "../types.js";

export const rule: SiteRule = {
  meta: {
    id: "crawl/site-url-not-configured",
    title: "Production site URL not configured",
    category: "crawl",
    severity: "warning",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: true,
    fix: "Set `site:` in mielikki.config.yaml to the production URL (e.g. https://example.fi), so canonicals, sitemaps and links are checked against it.",
    source: "mielikki:original",
  },
  checkSite(ctx) {
    if (ctx.config.site === undefined)
      ctx.report({
        message:
          "No site URL configured: set `site:` to the production URL (the origin guessed from canonicals is not trusted for launch)",
      });
  },
};
