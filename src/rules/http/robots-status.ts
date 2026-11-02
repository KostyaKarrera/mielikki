import type { SiteRule } from "../types.js";

export const rule: SiteRule = {
  meta: {
    id: "http/robots-status",
    title: "robots.txt answers with an error",
    category: "http",
    severity: "error",
    scope: "site",
    inputs: ["url"],
    launchBlocking: true,
    fix: "Make /robots.txt answer 200 (or 404 if there are no rules).",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt",
  },
  checkSite(ctx) {
    const { site } = ctx;
    if (site.origin === undefined) return;
    const url = `${site.origin}/robots.txt`;
    const rec = site.responses?.get(url);
    if (rec === undefined) return;
    if (rec.stop === "timeout" || rec.stop === "network") {
      ctx.report({ url, message: `${url} did not answer (${rec.stop})` });
      return;
    }
    const status = rec.final?.status;
    if (status === undefined) return;
    if (status >= 500)
      ctx.report({
        url,
        message: `${url} answers with server error ${status}`,
      });
    else if (status === 401 || status === 403)
      ctx.report({
        url,
        severity: "warning",
        message: `${url} answers ${status}; crawlers may treat the whole site as blocked`,
      });
  },
};
