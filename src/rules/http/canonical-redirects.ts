import { isIgnored, isIndexable } from "../../model/indexable.js";
import { pageKey, resolveHref } from "../../model/url.js";
import { mapToCrawl, normalizeCrawlUrl } from "../../net/policy.js";
import { isTargetPage } from "../targets/_helpers.js";
import type { PageRule } from "../types.js";

const noWww = (h: string): string => h.replace(/^www\./, "");

export const rule: PageRule = {
  meta: {
    id: "http/canonical-redirects",
    title: "Canonical differs in form from the page URL or redirects",
    category: "http",
    severity: "warning",
    scope: "page",
    inputs: ["url"],
    launchBlocking: true,
    fix: "Make the canonical the exact final URL of the page (same slash, case and host, no redirect).",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls",
  },
  checkPage(page, ctx) {
    const { site, config } = ctx;
    const origin = site.origin;
    if (origin === undefined || page.url === undefined) return;
    if (page.canonical === undefined || page.canonical.trim() === "") return;
    if (!URL.canParse(page.canonical.trim(), page.url)) return;

    // crawl/canonical-target already reports a missing or non-indexable target (R17).
    const target = resolveHref(page.canonical, page.key, site.site);
    if (
      target.internal &&
      target.key !== undefined &&
      target.key !== page.key &&
      !isTargetPage(config, page.key)
    ) {
      if (isIgnored(config, target.key)) return;
      const tp = site.byKey.get(target.key);
      if (tp === undefined || !isIndexable(site, tp)) return;
    }

    const siteOrigin =
      config.site !== undefined && URL.canParse(config.site)
        ? new URL(config.site).origin
        : undefined;
    const abs = new URL(page.canonical.trim(), page.url);
    const mapped = new URL(mapToCrawl(abs.href, origin, siteOrigin));
    const own = new URL(page.url);

    if (mapped.origin !== own.origin) {
      if (
        mapped.hostname !== own.hostname &&
        noWww(mapped.hostname) === noWww(own.hostname)
      )
        ctx.report({
          message: `Canonical ${page.canonical} differs from the page host (${own.hostname}) only by www`,
        });
      return;
    }
    if (
      mapped.pathname !== own.pathname &&
      pageKey(mapped.pathname).toLowerCase() ===
        pageKey(own.pathname).toLowerCase()
    ) {
      ctx.report({
        message: `Canonical ${page.canonical} differs from the page URL ${own.pathname} only in form (slash or case)`,
      });
      return;
    }
    const rec = site.responses?.get(
      normalizeCrawlUrl(`${mapped.origin}${mapped.pathname}${mapped.search}`)
        .url,
    );
    if (rec !== undefined && rec.hops.length > 0)
      ctx.report({
        message: `Canonical ${page.canonical} redirects (${rec.hops[0]?.status}) instead of being the final URL`,
      });
  },
};
