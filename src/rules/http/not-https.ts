import { isLocalHost } from "../../model/host.js";
import { normalizeCrawlUrl } from "../../net/policy.js";
import type { SiteRule } from "../types.js";
import { startUrl } from "./_helpers.js";

export const rule: SiteRule = {
  meta: {
    id: "http/not-https",
    title: "Site is served over plain HTTP",
    category: "http",
    severity: "error",
    scope: "site",
    inputs: ["url"],
    launchBlocking: true,
    fix: "Serve the whole site over HTTPS.",
    source: "https://developers.google.com/search/docs/crawling-indexing/https",
  },
  checkSite(ctx) {
    const { site } = ctx;
    const start = startUrl(site);
    const rec = site.responses?.get(normalizeCrawlUrl(start).url);
    const finalUrl = rec?.final?.url ?? start;
    if (!URL.canParse(finalUrl)) return;
    const u = new URL(finalUrl);
    if (u.protocol !== "http:" || isLocalHost(u.hostname)) return;
    ctx.report({
      url: finalUrl,
      message: `The start URL ends up on plain HTTP: ${finalUrl}`,
    });
  },
};
