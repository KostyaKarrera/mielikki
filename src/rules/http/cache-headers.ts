import type { SiteRule } from "../types.js";
import { firstExamples, isLocalOrigin } from "./_helpers.js";

const EXTS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "avif",
  "svg",
  "ico",
  "css",
  "js",
  "mjs",
]);
const MIN_AGE = 86400;

function cacheable(cc: string | undefined): boolean {
  if (cc === undefined) return false;
  const v = cc.toLowerCase();
  if (/\bimmutable\b/.test(v)) return true;
  const m = /\bmax-age=(\d+)/.exec(v);
  return m !== null && Number(m[1]) >= MIN_AGE;
}

export const rule: SiteRule = {
  meta: {
    id: "http/cache-headers",
    title: "Static files lack long-lived caching",
    category: "http",
    severity: "info",
    scope: "site",
    inputs: ["url"],
    launchBlocking: false,
    fix: "Send Cache-Control: public, max-age=31536000, immutable for fingerprinted images, CSS and JS.",
    source: "https://web.dev/articles/http-cache",
  },
  checkSite(ctx) {
    const { site } = ctx;
    if (site.origin === undefined || isLocalOrigin(site)) return;
    const bad: string[] = [];
    for (const a of site.assets.values()) {
      if (a.headers === undefined || !EXTS.has(a.ext)) continue;
      if (!cacheable(a.headers["cache-control"]))
        bad.push(`${site.origin}${encodeURI(a.key)}`);
    }
    if (bad.length === 0) return;
    ctx.report({
      message: `${bad.length} static file(s) have no cache-control max-age of at least ${MIN_AGE}s`,
      details: { count: bad.length, examples: firstExamples(bad) },
    });
  },
};
