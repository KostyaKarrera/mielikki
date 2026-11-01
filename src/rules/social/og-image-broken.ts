import { isIndexable } from "../../model/indexable.js";
import { resolveHref } from "../../model/url.js";
import type { PageRule } from "../types.js";
import { tag } from "./_helpers.js";

export const rule: PageRule = {
  meta: {
    id: "social/og-image-broken",
    title: "og:image file is missing",
    category: "social",
    severity: "warning",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Point og:image at an existing image file.",
    source: "mielikki:original",
  },
  checkPage(page, ctx) {
    const { site } = ctx;
    if (!isIndexable(site, page)) return;
    const src = tag(page.og, "og:image");
    if (src === undefined) return;
    const r = resolveHref(src, page.key, site.site);
    if (r.internal && r.key !== undefined && !site.assets.has(r.key))
      ctx.report({ message: `og:image "${src}" (${r.key}) does not exist` });
  },
};
