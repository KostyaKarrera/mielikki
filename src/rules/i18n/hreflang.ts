import { resolveHref } from "../../model/url.js";
import type { PageRule } from "../types.js";

const LANG = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;

export const rule: PageRule = {
  meta: {
    id: "i18n/hreflang",
    title: "hreflang annotations are invalid",
    category: "i18n",
    severity: "warning",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Use valid language codes, existing targets, reciprocal links and an x-default entry.",
    source:
      "https://developers.google.com/search/docs/specialty/international/localized-versions",
  },
  checkPage(page, ctx) {
    const { site } = ctx;
    if (page.hreflang.length === 0) return;
    for (const h of page.hreflang) {
      const code = h.lang.trim();
      if (code.toLowerCase() !== "x-default" && !LANG.test(code)) {
        ctx.report({
          message: `hreflang "${h.lang}" is not a valid language code`,
        });
        continue;
      }
      const r = resolveHref(h.href, page.key, site.site);
      if (!r.internal || r.key === undefined || r.key === page.key) continue;
      const target = site.byKey.get(r.key);
      if (target === undefined) {
        ctx.report({
          message: `hreflang ${code} points to ${r.key}, which does not exist`,
        });
        continue;
      }
      const back = target.hreflang.some(
        (t) => resolveHref(t.href, target.key, site.site).key === page.key,
      );
      if (!back)
        ctx.report({
          message: `hreflang ${code} target ${r.key} does not link back to ${page.key}`,
        });
    }
    const langs = new Set(
      page.hreflang.map((h) => h.lang.trim().toLowerCase()),
    );
    langs.delete("x-default");
    if (
      langs.size >= 2 &&
      !page.hreflang.some((h) => h.lang.trim().toLowerCase() === "x-default")
    )
      ctx.report({
        message: `${langs.size} hreflang languages but no x-default entry`,
      });
  },
};
