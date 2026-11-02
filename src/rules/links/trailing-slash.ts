import type { PageRule } from "../types.js";
import { navigableInternal } from "./_helpers.js";

export const rule: PageRule = {
  meta: {
    id: "links/trailing-slash",
    title: "Link contradicts trailing-slash policy",
    category: "links",
    severity: "info",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Make internal links follow the input.trailingSlash setting.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls",
  },
  checkPage(page, ctx) {
    const policy = ctx.config.input.trailingSlash;
    if (policy !== "always" && policy !== "never") return;
    const seen = new Set<string>();
    for (const l of navigableInternal(page.links)) {
      // Only page links: files (assets) and explicit .html paths are out of scope.
      if (
        !(l.key as string).endsWith("/") ||
        ctx.site.assets.has(l.key as string)
      )
        continue;
      let pathname: string;
      try {
        pathname = new URL(l.href, "http://mielikki.invalid/").pathname;
      } catch {
        continue;
      }
      if (/\.[^/.]+$/.test(pathname) || pathname === "/") continue;
      const hasSlash = pathname.endsWith("/");
      if (hasSlash === (policy === "always") || seen.has(l.href)) continue;
      seen.add(l.href);
      ctx.report({
        message: `Link "${l.href}" ${hasSlash ? "has" : "lacks"} a trailing slash (trailingSlash: ${policy})`,
      });
    }
  },
};
