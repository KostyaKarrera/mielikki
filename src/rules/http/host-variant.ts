import { formProbeUrls } from "../../load/probes.js";
import type { SiteRule } from "../types.js";

export const rule: SiteRule = {
  meta: {
    id: "http/host-variant",
    title: "www / non-www host variant is not redirected",
    category: "http",
    severity: "error",
    scope: "site",
    inputs: ["url"],
    launchBlocking: true,
    fix: "Redirect the other host variant (www or non-www) to the main host with a 301.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls",
  },
  checkSite(ctx) {
    const { site } = ctx;
    if (!URL.canParse(site.input.root)) return;
    const mainHost = new URL(site.input.root).hostname;
    const probe = formProbeUrls(site.input.root).find(
      (u) => new URL(u).hostname !== mainHost,
    );
    if (probe === undefined) return;
    const rec = site.responses?.get(probe);
    if (rec === undefined) return;
    const status = rec.final?.status;
    if (status === 200)
      ctx.report({
        url: probe,
        message: `${probe} answers 200 instead of redirecting to ${mainHost}; the site is reachable on two hosts`,
      });
    else if (rec.stop !== undefined || (status !== undefined && status >= 400))
      ctx.report({
        url: probe,
        severity: "info",
        message: `${probe} is not available (${rec.stop ?? status}); visitors typing the other host variant get an error`,
      });
  },
};
