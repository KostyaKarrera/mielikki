import { mapToCrawl, normalizeCrawlUrl } from "../../net/policy.js";
import type { SiteRule } from "../types.js";
import { navigableInternal, reportedByTrailingSlash } from "./_helpers.js";

export const rule: SiteRule = {
  meta: {
    id: "links/redirected",
    title: "Internal link points to a redirecting URL",
    category: "links",
    severity: "warning",
    scope: "site",
    inputs: ["url"],
    launchBlocking: false,
    fix: "Link straight to the final URL instead of the permanently redirecting one.",
    source: "squirrelscan:links/redirect-links",
  },
  checkSite(ctx) {
    const { site, config } = ctx;
    const origin = site.origin;
    if (origin === undefined || site.responses === undefined) return;
    const siteOrigin =
      config.site !== undefined && URL.canParse(config.site)
        ? new URL(config.site).origin
        : undefined;
    const sources = new Map<string, Set<string>>();
    for (const p of site.pages) {
      const base = p.url ?? `${origin}${encodeURI(p.key)}`;
      for (const l of navigableInternal(p.links)) {
        if (reportedByTrailingSlash(l, config.input.trailingSlash, site.assets))
          continue; // links/trailing-slash explains it (R17)
        if (!URL.canParse(l.href.trim(), base)) continue;
        const abs = new URL(l.href.trim(), base);
        const url = normalizeCrawlUrl(
          mapToCrawl(abs.href, origin, siteOrigin),
        ).url;
        const rec = site.responses.get(url);
        const first = rec?.hops[0];
        if (
          first === undefined ||
          (first.status !== 301 && first.status !== 308)
        )
          continue;
        const set = sources.get(url) ?? new Set<string>();
        sources.set(url, set);
        set.add(p.key);
      }
    }
    for (const url of [...sources.keys()].sort()) {
      const pages = [...(sources.get(url) as Set<string>)].sort();
      const rec = site.responses.get(url);
      const to = rec?.final?.url ?? rec?.hops[0]?.location ?? "";
      ctx.report({
        url,
        message: `${url} is linked from ${pages.length} page(s) but redirects (${rec?.hops[0]?.status}) to ${to}`,
        details: { pages, target: to },
      });
    }
  },
};
