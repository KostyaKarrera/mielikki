import type { PageRule } from "../types.js";

export const rule: PageRule = {
  meta: {
    id: "links/insecure-external",
    title: "External link uses http://",
    category: "links",
    severity: "info",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Use the https:// version of the external URL.",
    source: "mielikki:original",
  },
  checkPage(page, ctx) {
    const seen = new Set<string>();
    for (const l of page.links) {
      if (l.internal || !/^http:\/\//i.test(l.href) || seen.has(l.href))
        continue;
      seen.add(l.href);
      ctx.report({ message: `External link ${l.href} uses http://` });
    }
  },
};
