import { isIndexable } from "../../model/indexable.js";
import type { SiteRule } from "../types.js";

const SHINGLE = 5;
const MIN_TOKENS = 60;
const THRESHOLD = 0.9;

function jaccard(a: Set<string>, b: Set<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const s of small) if (large.has(s)) inter++;
  return inter / (a.size + b.size - inter);
}

export const rule: SiteRule = {
  meta: {
    id: "content/near-duplicate",
    title: "Near-duplicate pages",
    category: "content",
    severity: "warning",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Rewrite one page, merge the two, or point one canonical at the other.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls",
  },
  checkSite(ctx) {
    const items: { key: string; shingles: Set<string> }[] = [];
    for (const page of ctx.site.pages) {
      if (!isIndexable(ctx.site, page)) continue;
      const tokens = ctx.lang.tokenize(page.mainText);
      if (tokens.length < MIN_TOKENS) continue;
      const shingles = new Set<string>();
      for (let i = 0; i + SHINGLE <= tokens.length; i++)
        shingles.add(tokens.slice(i, i + SHINGLE).join(" "));
      items.push({ key: page.key, shingles });
    }
    items.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        if (!a || !b) continue;
        const sim = jaccard(a.shingles, b.shingles);
        if (sim >= THRESHOLD)
          ctx.report({
            url: a.key,
            message: `${a.key} is a near-duplicate of ${b.key} (similarity ${Math.round(sim * 100)}%)`,
            details: { other: b.key, similarity: sim },
          });
      }
  },
};
