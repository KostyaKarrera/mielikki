import { isIndexable } from "../../model/indexable.js";
import type { PageRule } from "../types.js";
import { tag } from "./_helpers.js";

function normalize(url: string, base: string): string | undefined {
  try {
    return new URL(url, base).href;
  } catch {
    return undefined;
  }
}

export const rule: PageRule = {
  meta: {
    id: "social/og-url-mismatch",
    title: "og:url differs from canonical",
    category: "social",
    severity: "info",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Make og:url equal to the canonical URL.",
    source: "squirrelscan:social/og-url-match",
  },
  checkPage(page, ctx) {
    const { site } = ctx;
    if (!isIndexable(site, page)) return;
    const ogUrl = tag(page.og, "og:url");
    const canonical = page.canonical?.trim();
    if (ogUrl === undefined || canonical === undefined || canonical === "")
      return;
    const base = new URL(page.key, site.site ?? "http://mielikki.invalid").href;
    const a = normalize(ogUrl, base);
    const b = normalize(canonical, base);
    if (a !== b)
      ctx.report({
        message: `og:url ${ogUrl} differs from canonical ${canonical}`,
      });
  },
};
