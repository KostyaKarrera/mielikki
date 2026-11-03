import type { SiteRule } from "../types.js";
import { internalRecords } from "./_helpers.js";

export const rule: SiteRule = {
  meta: {
    id: "http/redirect-chain",
    title: "Redirect chain or loop",
    category: "http",
    severity: "warning",
    scope: "site",
    inputs: ["url"],
    launchBlocking: false,
    fix: "Redirect straight to the final URL in a single step.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes",
  },
  checkSite(ctx) {
    for (const [url, rec] of internalRecords(ctx.site)) {
      if (rec.stop === "redirect-loop" || rec.stop === "too-many-redirects")
        ctx.report({
          url,
          severity: "error",
          message: `${url} ${rec.stop === "redirect-loop" ? "redirects in a loop" : "redirects too many times"}`,
          details: { chain: rec.hops.map((h) => h.url) },
        });
      else if (rec.hops.length >= 2)
        ctx.report({
          url,
          message: `${url} goes through ${rec.hops.length} redirects before the final URL`,
          details: {
            chain: [...rec.hops.map((h) => h.url), rec.final?.url ?? ""].filter(
              (u) => u !== "",
            ),
          },
        });
    }
  },
};
