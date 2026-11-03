import type { PageRule } from "../types.js";
import { isLocalOrigin } from "./_helpers.js";

export const rule: PageRule = {
  meta: {
    id: "http/mixed-content",
    title: "HTTPS page loads resources over HTTP",
    category: "http",
    severity: "warning",
    scope: "page",
    inputs: ["url"],
    launchBlocking: false,
    fix: "Load every script, stylesheet, image and frame over https://.",
    source:
      "https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content",
  },
  checkPage(page, ctx) {
    const { site } = ctx;
    if (page.url === undefined || !page.url.startsWith("https:")) return;
    if (isLocalOrigin(site)) return;
    const insecure = [
      ...page.resources.map((r) => r.src),
      ...page.images.map((i) => i.src),
    ]
      .map((s) => s.trim())
      .filter((s) => /^http:\/\//i.test(s));
    if (insecure.length === 0) return;
    const unique = [...new Set(insecure)].sort();
    ctx.report({
      url: page.url,
      message: `${unique.length} resource(s) load over http:// on an https page`,
      details: { resources: unique.slice(0, 5), count: unique.length },
    });
  },
};
