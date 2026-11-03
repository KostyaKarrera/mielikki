import type { SiteRule } from "../types.js";
import { firstExamples, isLocalOrigin } from "./_helpers.js";

const MIN_BYTES = 1400;
const ENCODINGS = new Set(["gzip", "br", "zstd"]);

export const rule: SiteRule = {
  meta: {
    id: "http/compression",
    title: "HTML is served without compression",
    category: "http",
    severity: "warning",
    scope: "site",
    inputs: ["url"],
    launchBlocking: false,
    fix: "Enable gzip or brotli compression for HTML responses.",
    source:
      "https://web.dev/articles/reduce-network-payloads-using-text-compression",
  },
  checkSite(ctx) {
    const { site } = ctx;
    if (site.origin === undefined || isLocalOrigin(site)) return;
    const bad: string[] = [];
    for (const p of site.pages) {
      if (p.headers === undefined) continue;
      if (Buffer.byteLength(p.html) <= MIN_BYTES) continue;
      const enc = (p.headers["content-encoding"] ?? "").trim().toLowerCase();
      if (!ENCODINGS.has(enc)) bad.push(p.url ?? `${site.origin}${p.key}`);
    }
    if (bad.length === 0) return;
    ctx.report({
      message: `${bad.length} HTML page(s) over ${MIN_BYTES} bytes are served uncompressed`,
      details: { count: bad.length, examples: firstExamples(bad) },
    });
  },
};
