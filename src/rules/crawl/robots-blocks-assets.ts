import { isRobotsAllowed } from "../../model/indexable.js";
import { resolveHref } from "../../model/url.js";
import type { SiteRule } from "../types.js";

const IMAGE = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"]);
const TAG = /<(?:link|script)\b[^>]*>/gi;
const ATTR = /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const ASSET = /\.(?:css|js|mjs)(?:[?#]|$)/i;

export const rule: SiteRule = {
  meta: {
    id: "crawl/robots-blocks-assets",
    title: "robots.txt blocks CSS, JS or images",
    category: "crawl",
    severity: "warning",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Allow Googlebot to fetch the CSS, JS and image files that pages use.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/robots/intro",
  },
  checkSite(ctx) {
    const { site } = ctx;
    if (site.robots === undefined) return;
    // robots-blocks-all already reports a blanket Disallow.
    if (site.robots.disallowsAll("Googlebot")) return;
    const used = new Map<string, string>(); // asset key -> first page using it
    for (const page of site.pages) {
      const keys: string[] = [];
      for (const img of page.images)
        if (
          img.key !== undefined &&
          IMAGE.has(img.key.split(".").pop()?.toLowerCase() ?? "")
        )
          keys.push(img.key);
      for (const tag of page.html.match(TAG) ?? []) {
        const m = ATTR.exec(tag);
        const href = m?.[1] ?? m?.[2];
        if (href === undefined || !ASSET.test(href)) continue;
        const r = resolveHref(href, page.key, site.site);
        if (r.internal && r.key !== undefined) keys.push(r.key);
      }
      for (const k of keys) if (!used.has(k)) used.set(k, page.key);
    }
    for (const [key, pageKey] of [...used].sort(([x], [y]) => (x < y ? -1 : 1)))
      if (!isRobotsAllowed(site, key))
        ctx.report({
          url: key,
          message: `${key} (used by ${pageKey}) is blocked for Googlebot by robots.txt`,
        });
  },
};
