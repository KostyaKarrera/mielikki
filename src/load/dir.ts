import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Config } from "../config/schema.js";
import type { Asset, Page, Site } from "../model/types.js";
import { pageKey, resolveHref } from "../model/url.js";
import { parsePage } from "../parse/page.js";
import { parseRobots } from "../parse/robots.js";
import { parseSitemap, type SitemapInfo } from "../parse/sitemap.js";

const HTML = /\.html?$/i;
const DEFAULT_SITEMAPS = [
  "/sitemap.xml",
  "/sitemap-index.xml",
  "/sitemap_index.xml",
];

/** URL path of a file: encoded so that literal '%', '?' and '#' in names survive pageKey. */
function fileUrlPath(rel: string): string {
  return encodeURI(`/${rel}`).replace(/[?#]/g, (c) => encodeURIComponent(c));
}

async function walk(root: string, rel = ""): Promise<string[]> {
  const entries = await readdir(path.join(root, rel), { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const out: string[] = [];
  for (const e of entries) {
    const r = rel === "" ? e.name : `${rel}/${e.name}`;
    if (e.isDirectory()) out.push(...(await walk(root, r)));
    else if (e.isFile()) out.push(r);
  }
  return out;
}

function detectSite(pages: Page[]): string | undefined {
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

async function readText(
  root: string,
  urlPath: string,
): Promise<string | undefined> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
  const abs = path.join(root, decoded);
  if (!abs.startsWith(root + path.sep)) return undefined;
  try {
    return await readFile(abs, "utf8");
  } catch {
    return undefined;
  }
}

async function loadSitemaps(
  root: string,
  listed: string[],
): Promise<SitemapInfo[]> {
  const out: SitemapInfo[] = [];
  const seen = new Set<string>();
  const visit = async (urlPath: string, mustExist: boolean): Promise<void> => {
    if (seen.has(urlPath)) return;
    seen.add(urlPath);
    const xml = await readText(root, urlPath);
    if (xml === undefined) {
      if (mustExist)
        out.push({
          file: urlPath,
          ok: false,
          error: "file not found in input directory",
          urls: [],
          isIndex: false,
        });
      return;
    }
    const info = parseSitemap(xml, urlPath);
    out.push(info);
    if (info.ok && info.isIndex)
      for (const loc of info.urls) {
        if (!URL.canParse(loc)) continue;
        await visit(new URL(loc).pathname, true);
      }
  };
  if (listed.length > 0) {
    for (const u of listed)
      if (URL.canParse(u)) await visit(new URL(u).pathname, true);
  } else {
    for (const p of DEFAULT_SITEMAPS) await visit(p, false);
  }
  return out;
}

function push(map: Map<string, string[]>, key: string, from: string): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [from]);
  else if (!list.includes(from)) list.push(from);
}

export async function loadDir(dir: string, config: Config): Promise<Site> {
  const root = path.resolve(dir);
  const files = await walk(root);

  const pages: Page[] = [];
  let notFound: Page | undefined;
  const assets = new Map<string, Asset>();
  for (const rel of files) {
    if (HTML.test(rel)) {
      const html = await readFile(path.join(root, rel), "utf8");
      const page = parsePage(html, pageKey(fileUrlPath(rel)), rel);
      if (rel === "404.html") notFound = page;
      else pages.push(page);
    } else {
      const key = `/${rel}`;
      const { size } = await stat(path.join(root, rel));
      assets.set(key, {
        key,
        bytes: size,
        ext: path.extname(rel).slice(1).toLowerCase(),
      });
    }
  }
  pages.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const byKey = new Map<string, Page>();
  const unique: Page[] = [];
  for (const p of pages)
    if (!byKey.has(p.key)) {
      byKey.set(p.key, p);
      unique.push(p);
    }

  const siteUrl = config.site ?? detectSite(unique);

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

  const robotsRaw = await readText(root, "/robots.txt");
  const robots =
    robotsRaw === undefined ? undefined : parseRobots(robotsRaw, siteUrl);
  const sitemaps = await loadSitemaps(root, robots?.sitemaps ?? []);

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

  return {
    input: { kind: "dir", root },
    config,
    site: siteUrl,
    pages: unique,
    notFound,
    robots,
    sitemaps,
    assets,
    byKey,
    inlinks,
    inlinksAll,
    depth,
  };
}
