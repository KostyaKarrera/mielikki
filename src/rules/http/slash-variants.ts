import { isIgnored } from "../../model/indexable.js";
import { pageKey } from "../../model/url.js";
import { isAssetPath } from "../../net/policy.js";
import type { SiteRule } from "../types.js";
import { internalRecords } from "./_helpers.js";

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const rule: SiteRule = {
  meta: {
    id: "http/slash-variants",
    title: "Page is also served at another URL (trailing slash, index.html)",
    category: "http",
    severity: "warning",
    scope: "site",
    inputs: ["url"],
    launchBlocking: false,
    fix: "Redirect the other URL forms (opposite trailing slash, /index.html, other spelling) to the main URL with a 301.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls",
  },
  checkSite(ctx) {
    const { site, config } = ctx;
    const origin = site.origin;
    if (origin === undefined) return;
    // Every URL that answered 200 itself (not via a redirect: /a -> /a/ is fine),
    // crawled or probed, grouped by the page it is a form of.
    const groups = new Map<string, Set<string>>();
    for (const [, rec] of internalRecords(site)) {
      const f = rec.final;
      if (f?.status !== 200 || rec.hops.length > 0 || !URL.canParse(f.url))
        continue;
      const u = new URL(f.url);
      if (u.origin !== origin || isAssetPath(u.pathname)) continue;
      const key = pageKey(u.pathname);
      if (isIgnored(config, key)) continue;
      const set = groups.get(key) ?? new Set<string>();
      groups.set(key, set);
      set.add(u.pathname);
    }
    for (const key of [...groups.keys()].sort(byString)) {
      const paths = [...(groups.get(key) as Set<string>)].sort(byString);
      if (paths.length < 2) continue;
      const page = site.byKey.get(key);
      const own = page?.url !== undefined ? new URL(page.url).pathname : "";
      const main = paths.includes(own) ? own : (paths[0] as string);
      const others = paths.filter((p) => p !== main);
      const message =
        others.length === 1
          ? `Both ${main} and ${others[0]} answer 200 (duplicate content)`
          : `${main}, ${others.slice(0, -1).join(", ")} and ${others.at(-1)} all answer 200 (duplicate content)`;
      ctx.report({
        url: page?.url ?? `${origin}${main}`,
        message,
        details: { urls: paths.map((p) => `${origin}${p}`) },
      });
    }
  },
};
