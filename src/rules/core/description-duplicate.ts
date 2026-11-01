import { isIndexable } from "../../model/indexable.js";
import type { SiteRule } from "../types.js";

const normalize = (s: string): string =>
  s.trim().replace(/\s+/g, " ").toLowerCase();

export const rule: SiteRule = {
  meta: {
    id: "core/description-duplicate",
    title: "Several pages share a description",
    category: "core",
    severity: "warning",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Give each indexable page its own description.",
    source: "https://developers.google.com/search/docs/appearance/snippet",
  },
  checkSite(ctx) {
    const groups = new Map<string, string[]>();
    for (const page of ctx.site.pages) {
      if (!isIndexable(ctx.site, page)) continue;
      const text = normalize(page.metaDescription ?? "");
      if (text === "") continue;
      const keys = groups.get(text);
      if (keys) keys.push(page.key);
      else groups.set(text, [page.key]);
    }
    for (const keys of [...groups.values()].sort((a, b) =>
      a[0] < b[0] ? -1 : 1,
    ))
      if (keys.length >= 2)
        for (const key of keys)
          ctx.report({
            url: key,
            message: `Description is shared with ${keys.filter((k) => k !== key).join(", ")}`,
          });
  },
};
