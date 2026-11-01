import { isLocalHost } from "../../model/host.js";
import type { PageRule } from "../types.js";

export const rule: PageRule = {
  meta: {
    id: "core/canonical-invalid",
    title: "Canonical link is invalid",
    category: "core",
    severity: "error",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: true,
    fix: "Use a single absolute canonical URL on the site host.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls",
  },
  checkPage(page, ctx) {
    if (page.canonicalCount > 1) {
      ctx.report({
        message: `${page.key} has ${page.canonicalCount} canonical links`,
      });
      return;
    }
    const href = page.canonical?.trim();
    if (!href) return;
    if (!/^https?:\/\//i.test(href)) {
      ctx.report({ message: `Canonical "${href}" is not an absolute URL` });
      return;
    }
    if (!URL.canParse(href)) {
      ctx.report({ message: `Canonical "${href}" is not a valid URL` });
      return;
    }
    const host = new URL(href).host;
    // Local/private hosts are never valid, even when they are the detected origin.
    if (isLocalHost(host)) {
      ctx.report({
        message: `Canonical ${href} is on a local/private host (${host})`,
      });
      return;
    }
    if (ctx.site.site === undefined || !URL.canParse(ctx.site.site)) return;
    const siteHost = new URL(ctx.site.site).host;
    if (host !== siteHost)
      ctx.report({
        message: `Canonical host ${host} differs from site host ${siteHost}`,
      });
  },
};
