import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Config } from "../config/schema.js";
import { isIgnored } from "../model/indexable.js";
import type { Asset, Page, Site } from "../model/types.js";
import { pageKey } from "../model/url.js";
import { parseRobots } from "../parse/robots.js";
import { PageUnparseableError, parsePageSafe } from "../parse/safe.js";
import {
  buildSiteGraph,
  collectSitemaps,
  DEFAULT_SITEMAPS,
  dedupeByKey,
  detectSite,
} from "./graph.js";

const HTML = /\.html?$/i;
/** The not-found page: /404.html, or /404/index.html of directory-style builds. */
const NOT_FOUND = /^404(\/index)?\.html?$/i;

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

export async function loadDir(dir: string, config: Config): Promise<Site> {
  const root = path.resolve(dir);
  const files = await walk(root);

  const pages: Page[] = [];
  let notFound: Page | undefined;
  const assets = new Map<string, Asset>();
  const unparsed: NonNullable<Site["unparsed"]> = [];
  for (const rel of files) {
    if (HTML.test(rel)) {
      const html = await readFile(path.join(root, rel), "utf8");
      let page: Page;
      try {
        page = await parsePageSafe(html, pageKey(fileUrlPath(rel)), rel, {
          own: true,
        });
      } catch (e) {
        // only "cannot be parsed within bounds" is a finding; a bug propagates
        if (!(e instanceof PageUnparseableError)) throw e;
        unparsed.push({ url: rel, reason: e.reason, depth: e.depth });
        continue;
      }
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
  const sitemaps = await collectSitemaps({
    listed: robots?.sitemaps ?? [],
    defaults: DEFAULT_SITEMAPS,
    locate: (loc) => (URL.canParse(loc) ? new URL(loc).pathname : undefined),
    read: async (urlPath, mustExist) =>
      (await readText(root, urlPath)) ??
      (mustExist ? { error: "file not found in input directory" } : undefined),
  });

  return {
    input: { kind: "dir", root },
    config,
    site: siteUrl,
    // exclude.ignore: not checked, but kept in byKey/inlinks/depth so links resolve.
    pages: unique.filter((p) => !isIgnored(config, p.key)),
    notFound,
    ...(unparsed.length > 0 ? { unparsed } : {}),
    robots,
    sitemaps,
    assets,
    byKey,
    inlinks,
    inlinksAll,
    depth,
  };
}
