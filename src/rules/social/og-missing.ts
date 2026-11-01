import { isIndexable } from "../../model/indexable.js";
import type { PageRule } from "../types.js";
import { tag } from "./_helpers.js";

export const rule: PageRule = {
  meta: {
    id: "social/og-missing",
    title: "Open Graph tags are missing",
    category: "social",
    severity: "warning",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Add og:title, og:description and og:image meta tags.",
    source: "mielikki:original",
  },
  checkPage(page, ctx) {
    if (!isIndexable(ctx.site, page)) return;
    const missing = ["og:title", "og:description", "og:image"].filter(
      (n) => tag(page.og, n) === undefined,
    );
    if (missing.length > 0)
      ctx.report({ message: `Missing ${missing.join(", ")}` });
  },
};
