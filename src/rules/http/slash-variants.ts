import { slashVariant } from "../../load/probes.js";
import type { SiteRule } from "../types.js";

export const rule: SiteRule = {
  meta: {
    id: "http/slash-variants",
    title: "Page is also served with the opposite trailing slash",
    category: "http",
    severity: "warning",
    scope: "site",
    inputs: ["url"],
    launchBlocking: false,
    fix: "Redirect one trailing-slash form to the other with a 301.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls",
  },
  checkSite(ctx) {
    const { site } = ctx;
    const origin = site.origin;
    if (origin === undefined || site.responses === undefined) return;
    for (const p of site.pages) {
      if (p.key === "/") continue;
      const path =
        p.url !== undefined ? new URL(p.url).pathname : encodeURI(p.key);
      const other = slashVariant(path);
      if (other === undefined) continue;
      const rec = site.responses.get(`${origin}${other}`);
      // A redirected request (e.g. a crawled link) is not a duplicate.
      if (rec?.final?.status !== 200 || rec.hops.length > 0) continue;
      ctx.report({
        url: p.url ?? `${origin}${path}`,
        message: `Both ${path} and ${other} answer 200 (duplicate content)`,
      });
    }
  },
};
