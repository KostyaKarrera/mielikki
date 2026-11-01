import { isIndexable } from "../../model/indexable.js";
import { clusterPairs, percentRange, type SimilarPair } from "../_cluster.js";
import { swapTestScope } from "../local/swap-test.js";
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
    fix: "Rewrite the pages so each is distinct, merge them, or point their canonicals at one of them.",
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
    // Pairs of area pages are judged by local/swap-test instead.
    const swap = swapTestScope(ctx.config);
    const pairs: SimilarPair[] = [];
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        if (!a || !b) continue;
        if (swap?.(a.key) && swap(b.key)) continue;
        const similarity = jaccard(a.shingles, b.shingles);
        if (similarity >= THRESHOLD)
          pairs.push({ a: a.key, b: b.key, similarity });
      }
    for (const c of clusterPairs(pairs))
      ctx.report({
        url: c.pages[0],
        message: `${c.pages.length} pages are near-duplicates (similarity ${percentRange(c)}): ${c.pages.join(", ")}`,
        details: {
          pages: c.pages,
          similarity: { min: c.min, max: c.max },
        },
      });
  },
};
