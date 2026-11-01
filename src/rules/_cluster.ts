/** A similar pair of pages found by a pairwise rule. */
export interface SimilarPair {
  a: string;
  b: string;
  similarity: number;
}

/** A connected group of similar pages. */
export interface Cluster {
  /** Page keys, sorted. */
  pages: string[];
  /** Lowest and highest similarity among the group's pairs. */
  min: number;
  max: number;
}

const cmp = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);

/**
 * Joins pairs into connected groups (union-find), so a pairwise rule can
 * report one finding per group instead of one per pair. Deterministic: groups
 * are sorted by their smallest key.
 */
export function clusterPairs(pairs: SimilarPair[]): Cluster[] {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let root = k;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    // path compression
    let cur = k;
    while (cur !== root) {
      const next = parent.get(cur) as string;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  for (const { a, b } of pairs) {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    // the smaller key becomes the root, so roots do not depend on pair order
    if (ra !== rb) {
      if (ra < rb) parent.set(rb, ra);
      else parent.set(ra, rb);
    }
  }
  const groups = new Map<string, Cluster>();
  for (const k of parent.keys()) {
    const r = find(k);
    const g = groups.get(r);
    if (g) g.pages.push(k);
    else
      groups.set(r, {
        pages: [k],
        min: Number.POSITIVE_INFINITY,
        max: Number.NEGATIVE_INFINITY,
      });
  }
  for (const { a, similarity } of pairs) {
    const g = groups.get(find(a)) as Cluster;
    g.min = Math.min(g.min, similarity);
    g.max = Math.max(g.max, similarity);
  }
  const out = [...groups.values()];
  for (const g of out) g.pages.sort(cmp);
  return out.sort((x, y) => cmp(x.pages[0] ?? "", y.pages[0] ?? ""));
}

/** "90%" or "90–95%". */
export function percentRange(c: Cluster): string {
  const lo = Math.round(c.min * 100);
  const hi = Math.round(c.max * 100);
  return lo === hi ? `${lo}%` : `${lo}–${hi}%`;
}
