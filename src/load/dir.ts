import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Config } from "../config/schema.js";
import { isIgnored } from "../model/indexable.js";
import type { Asset, Page, Site } from "../model/types.js";
import { pageKey } from "../model/url.js";
import { parsePage } from "../parse/page.js";
import { parseRobots } from "../parse/robots.js";
import { parseSitemap, type SitemapInfo } from "../parse/sitemap.js";
import { buildSiteGraph, dedupeByKey, detectSite } from "./graph.js";

const HTML = /\.html?$/i;
/** The not-found page: /404.html, or /404/index.html of directory-style builds. */
const NOT_FOUND = /^404(\/index)?\.html?$/i;
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
      if (NOT_FOUND.test(rel)) notFound ??= page;
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
  const siteUrl = config.site ?? detectSite(dedupeByKey(pages));
  const { byKey, unique, inlinks, inlinksAll, depth } = buildSiteGraph({
    pages,
    notFound,
    siteUrl,
    config,
  });

  const robotsRaw = await readText(root, "/robots.txt");
  const robots =
    robotsRaw === undefined ? undefined : parseRobots(robotsRaw, siteUrl);
  const sitemaps = await loadSitemaps(root, robots?.sitemaps ?? []);

  return {
    input: { kind: "dir", root },
    config,
    site: siteUrl,
    // exclude.ignore: not checked, but kept in byKey/inlinks/depth so links resolve.
    pages: unique.filter((p) => !isIgnored(config, p.key)),
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
