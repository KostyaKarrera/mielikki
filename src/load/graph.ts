import type { Config } from "../config/schema.js";
import type { Page } from "../model/types.js";
import { resolveHref } from "../model/url.js";

export function detectSite(pages: Page[]): string | undefined {
  const counts = new Map<string, number>();
  for (const p of pages) {
    const c = p.canonical?.trim() ?? "";
    if (!/^https?:\/\//i.test(c) || !URL.canParse(c)) continue;
    const origin = new URL(c).origin;
    counts.set(origin, (counts.get(origin) ?? 0) + 1);
  }
  let best: string | undefined;
  let max = 0;
  for (const [origin, n] of [...counts].sort(([a], [b]) => (a < b ? -1 : 1)))
    if (n > max) {
      best = origin;
      max = n;
    }
  return best;
}

function push(map: Map<string, string[]>, key: string, from: string): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [from]);
  else if (!list.includes(from)) list.push(from);
}

/** First page per key, in input order. */
export function dedupeByKey(pages: Page[]): Page[] {
  const seen = new Set<string>();
  const out: Page[] = [];
  for (const p of pages)
    if (!seen.has(p.key)) {
      seen.add(p.key);
      out.push(p);
    }
  return out;
}

export function buildSiteGraph(input: {
  pages: Page[];
  notFound?: Page;
  siteUrl?: string;
  config: Config;
}): {
  byKey: Map<string, Page>;
  unique: Page[];
  inlinks: Map<string, string[]>;
  inlinksAll: Map<string, string[]>;
  depth: Map<string, number>;
} {
  const { notFound, siteUrl } = input;
  const unique = dedupeByKey(input.pages);
  const byKey = new Map<string, Page>(unique.map((p) => [p.key, p]));

  for (const p of [...unique, ...(notFound ? [notFound] : [])]) {
    for (const l of p.links) {
      const r = resolveHref(l.href, p.key, siteUrl);
      l.internal = r.internal;
      l.key = r.key;
    }
    for (const img of p.images) {
      const r =
        img.src === ""
          ? { internal: false }
          : resolveHref(img.src, p.key, siteUrl);
      img.key = r.internal ? r.key : undefined;
    }
  }

  const inlinks = new Map<string, string[]>();
  const inlinksAll = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const p of unique)
    for (const l of p.links) {
      if (!l.internal || l.key === undefined || l.key === p.key) continue;
      push(inlinksAll, l.key, p.key);
      if (!l.inChrome) push(inlinks, l.key, p.key);
      push(outgoing, p.key, l.key);
    }

  const depth = new Map<string, number>();
  if (byKey.has("/")) {
    depth.set("/", 0);
    const queue = ["/"];
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i] as string;
      for (const next of outgoing.get(cur) ?? [])
        if (byKey.has(next) && !depth.has(next)) {
          depth.set(next, (depth.get(cur) ?? 0) + 1);
          queue.push(next);
        }
    }
  }
  return { byKey, unique, inlinks, inlinksAll, depth };
}
