import type { SiteRule } from "../types.js";
import { internalRecords } from "./_helpers.js";

const STOPS = new Set(["timeout", "network", "too-large"]);

export const rule: SiteRule = {
  meta: {
    id: "http/unreachable",
    title: "Internal URL is unreachable or fails with a server error",
    category: "http",
    severity: "error",
    scope: "site",
    inputs: ["url"],
    launchBlocking: true,
    fix: "Make the URL answer reliably (fix the server error or timeout), or stop linking to it.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/http-network-errors",
  },
  checkSite(ctx) {
    for (const [url, rec] of internalRecords(ctx.site)) {
      if (url.endsWith("/robots.txt")) continue; // http/robots-status
      if (rec.stop !== undefined && STOPS.has(rec.stop))
        ctx.report({
          url,
          message: `${url} did not answer (${rec.stop}${rec.detail ? `: ${rec.detail}` : ""})`,
        });
      else if (rec.final !== undefined && rec.final.status >= 500)
        ctx.report({
          url,
          message: `${url} answers with server error ${rec.final.status}`,
        });
    }
  },
};
