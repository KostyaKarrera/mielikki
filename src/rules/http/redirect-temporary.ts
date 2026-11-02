import { mapToCrawl, normalizeCrawlUrl } from "../../net/policy.js";
import type { SiteRule } from "../types.js";
import { internalRecords, startUrl } from "./_helpers.js";

const TEMPORARY = new Set([302, 303, 307]);

export const rule: SiteRule = {
  meta: {
    id: "http/redirect-temporary",
    title: "Important URL uses a temporary redirect",
    category: "http",
    severity: "warning",
    scope: "site",
    inputs: ["url"],
    launchBlocking: false,
    fix: "Use a permanent redirect (301 or 308) when the move is permanent.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/301-redirects",
  },
  checkSite(ctx) {
    const { site, config } = ctx;
    const origin = site.origin;
    if (origin === undefined) return;
    const siteOrigin =
      config.site !== undefined && URL.canParse(config.site)
        ? new URL(config.site).origin
        : undefined;
    const important = new Set<string>([normalizeCrawlUrl(startUrl(site)).url]);
    const add = (href: string, base: string): void => {
      if (!URL.canParse(href, base)) return;
      const abs = new URL(href.trim(), base);
      if (abs.protocol !== "http:" && abs.protocol !== "https:") return;
      important.add(
        normalizeCrawlUrl(mapToCrawl(abs.href, origin, siteOrigin)).url,
      );
    };
    for (const sm of site.sitemaps)
      if (!sm.isIndex) for (const loc of sm.urls) add(loc, origin);
    for (const p of site.pages)
      for (const l of p.links)
        if (l.internal && !l.inChrome && l.href.trim() !== "")
          add(l.href, p.url ?? `${origin}${encodeURI(p.key)}`);

    for (const [url, rec] of internalRecords(site)) {
      const first = rec.hops[0];
      if (first === undefined || !TEMPORARY.has(first.status)) continue;
      if (!important.has(url)) continue;
      ctx.report({
        url,
        message: `${url} answers with a temporary redirect (${first.status})${first.location ? ` to ${first.location}` : ""}`,
      });
    }
  },
};
