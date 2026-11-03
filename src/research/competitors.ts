import { getLang } from "../lang/index.js";
import type { FetchRecord, Page } from "../model/types.js";
import type { Fetcher } from "../net/fetch.js";
import {
  isAssetPath,
  normalizeCrawlUrl,
  parseStartUrl,
} from "../net/policy.js";
import { parsePage } from "../parse/page.js";
import { parseRobots, type RobotsInfo } from "../parse/robots.js";
import { parseSitemap } from "../parse/sitemap.js";
import type { ResearchError } from "./types.js";

export interface CompetitorPage {
  url: string;
  path: string;
  title: string | null;
  h1: string[];
  h2: string[];
  schemaTypes: string[];
  wordCount: number;
  kind: "home" | "service" | "area" | "other";
  depth: number;
}

export interface CompetitorReport {
  site: string;
  sitemapUrls: number;
  pagesAnalyzed: number;
  stoppedBy: "done" | "max-pages";
  urlPatterns: { pattern: string; count: number }[];
  pages: CompetitorPage[];
  terms: { term: string; pages: number }[];
  errors: ResearchError[];
}

export interface CompetitorOptions {
  maxPages: number;
  language?: "fi" | "sv" | "en";
  areaHints: string[];
}

const SOURCE = "competitors";
const MAX_SITEMAP_SEEDS = 200;
const MAX_SITEMAP_FILES = 5;
const MAX_HEADINGS = 20;
const MAX_SCHEMA_TYPES = 20;
const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const SERVICE_SEGMENT = /^(palvelu\w*|tjanster|services)$/;
const AREA_SEGMENT = /^(alue\w*|omraden|areas)$/;

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Untrusted text: control characters out, whitespace collapsed, cut to `max`. */
export function clean(s: string, max = 300): string {
  const t = s
    .replace(/\s+/gu, " ")
    .replace(/[\p{Cc}\p{Cf}\uFFFD]/gu, "")
    .replace(/ {2,}/g, " ")
    .trim();
  // Cut by code points so a surrogate pair is never split.
  return Array.from(t).slice(0, max).join("").trim();
}

/** Lowercase ASCII-ish form for comparing path segments with area names. */
function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function kindOf(pathname: string, hints: string[]): CompetitorPage["kind"] {
  const segs = pathname.split("/").filter(Boolean).map(decodeSegment);
  if (segs.length === 0) return "home";
  const slugs = segs.map(slug);
  // The leftmost segment that names a service or an area decides.
  for (const sg of slugs)
    for (const w of sg.split("-")) {
      if (SERVICE_SEGMENT.test(w)) return "service";
      if (AREA_SEGMENT.test(w)) return "area";
    }
  for (const h of hints) {
    const hs = slug(h);
    if (hs.length >= 3 && slugs.some((s) => s.includes(hs))) return "area";
  }
  return "other";
}

function patternOf(pathname: string): string {
  const segs = pathname.split("/").filter(Boolean);
  if (segs.length === 0) return "/";
  return `/${segs.map((s, i) => (i === 0 ? clean(decodeSegment(s), 100) : "*")).join("/")}`;
}

function collectTypes(node: unknown, out: Set<string>, depth = 0): void {
  if (depth > 6 || node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node.slice(0, 50)) collectTypes(n, out, depth + 1);
    return;
  }
  const o = node as Record<string, unknown>;
  const t = o["@type"];
  for (const v of Array.isArray(t) ? t.slice(0, 50) : [t])
    if (typeof v === "string") {
      const c = clean(v, 100);
      if (c !== "") out.add(c);
    }
  const graph = o["@graph"];
  if (graph !== undefined) collectTypes(graph, out, depth + 1);
}

function schemaTypesOf(page: Page): string[] {
  const out = new Set<string>();
  for (const b of page.jsonld)
    if (b.data !== undefined) collectTypes(b.data, out);
  return [...out].sort(byString).slice(0, MAX_SCHEMA_TYPES);
}

const mediaType = (ct: string | undefined): string =>
  ct?.split(";")[0]?.trim().toLowerCase() ?? "";

function failure(rec: FetchRecord): string | undefined {
  if (rec.stop !== undefined) return rec.detail ?? rec.stop;
  if (rec.final === undefined) return "network";
  if (rec.final.status >= 400) return `HTTP ${rec.final.status}`;
  return undefined;
}

function termsOf(
  pages: { text: string[] }[],
  language: CompetitorOptions["language"],
): { term: string; pages: number }[] {
  const lang = getLang(language);
  const counts = new Map<
    string,
    { pages: number; forms: Map<string, number> }
  >();
  for (const p of pages) {
    const seen = new Set<string>();
    for (const t of p.text)
      for (const tok of lang.tokenize(t)) {
        if (tok.length < 3 || /^\d+$/.test(tok) || lang.stopwords.has(tok))
          continue;
        const stem = lang.stem(tok);
        let e = counts.get(stem);
        if (e === undefined) {
          e = { pages: 0, forms: new Map() };
          counts.set(stem, e);
        }
        e.forms.set(tok, (e.forms.get(tok) ?? 0) + 1);
        if (!seen.has(stem)) {
          seen.add(stem);
          e.pages++;
        }
      }
  }
  return [...counts.values()]
    .map((e) => ({
      term: [...e.forms.entries()].sort(
        (a, b) => b[1] - a[1] || byString(a[0], b[0]),
      )[0]?.[0] as string,
      pages: e.pages,
    }))
    .sort((a, b) => b.pages - a.pages || byString(a.term, b.term))
    .slice(0, 30);
}

export async function analyzeCompetitor(
  startUrl: string,
  fetcher: Fetcher,
  o: CompetitorOptions,
): Promise<CompetitorReport> {
  const start = parseStartUrl(startUrl);
  const origin = start.origin;
  const bare = (h: string): string => h.replace(/^www\./, "");
  const errors: ResearchError[] = [];
  const addError = (target: string, message: string): void => {
    errors.push({
      source: SOURCE,
      target: clean(target, 200),
      message: clean(message, 200),
    });
  };
  const report = (
    pages: CompetitorPage[],
    texts: { text: string[] }[],
    sitemapUrls: number,
    stoppedBy: CompetitorReport["stoppedBy"],
  ): CompetitorReport => {
    pages.sort((a, b) => byString(a.path, b.path));
    const patterns = new Map<string, number>();
    for (const p of pages) {
      const k = patternOf(p.path);
      patterns.set(k, (patterns.get(k) ?? 0) + 1);
    }
    errors.sort(
      (a, b) => byString(a.target, b.target) || byString(a.message, b.message),
    );
    return {
      site: origin,
      sitemapUrls,
      pagesAnalyzed: pages.length,
      stoppedBy,
      urlPatterns: [...patterns.entries()]
        .map(([pattern, count]) => ({ pattern, count }))
        .sort((a, b) => b.count - a.count || byString(a.pattern, b.pattern)),
      pages,
      terms: termsOf(texts, o.language),
      errors,
    };
  };

  // Every request goes through here: never to another origin.
  const get = (url: string): Promise<FetchRecord> => {
    if (new URL(url).origin !== origin)
      throw new Error(`refusing to request off-host URL ${url}`);
    return fetcher.get(url);
  };

  // robots.txt is always obeyed; there is no switch to turn it off.
  const robotsUrl = `${origin}/robots.txt`;
  const robotsRec = await get(robotsUrl);
  let robots: RobotsInfo | undefined;
  if (robotsRec.final?.status === 200) {
    robots = parseRobots(robotsRec.final.body ?? "", origin);
  } else if (
    robotsRec.final === undefined ||
    robotsRec.final.status >= 500 ||
    robotsRec.final.status === 429 ||
    (robotsRec.final.status >= 300 && robotsRec.final.status < 400)
  ) {
    // Unknown rules: do not crawl.
    const target = /^redirect to (\S+)/.exec(robotsRec.detail ?? "")?.[1];
    const host =
      target !== undefined && URL.canParse(target)
        ? new URL(target).host
        : undefined;
    addError(
      robotsUrl,
      host !== undefined && host !== start.host
        ? `${start.host} redirects to ${host}: pass the canonical URL`
        : `robots.txt unavailable (${failure(robotsRec) ?? "no answer"}); site not crawled`,
    );
    return report([], [], 0, "done");
  }
  const allowed = (u: URL): boolean =>
    robots === undefined || robots.isAllowed(u.pathname + u.search, "Mielikki");
  if (!allowed(start)) {
    addError(start.href, "blocked by robots.txt");
    return report([], [], 0, "done");
  }

  // Sitemap URLs on the same host (www/apex alike), re-based on the crawl origin.
  const seeds: string[] = [];
  const sitemapSeen = new Set<string>();
  let sitemapUrls = 0;
  const queue = (robots?.sitemaps ?? [])
    .filter((s) => URL.canParse(s))
    .map((s) => new URL(s))
    .filter((s) => bare(s.hostname) === bare(start.hostname))
    .map((s) => `${origin}${s.pathname}${s.search}`);
  if (queue.length === 0) queue.push(`${origin}/sitemap.xml`);
  for (
    let i = 0, files = 0;
    i < queue.length && files < MAX_SITEMAP_FILES;
    i++
  ) {
    const smUrl = queue[i] as string;
    if (sitemapSeen.has(smUrl)) continue;
    sitemapSeen.add(smUrl);
    files++;
    const rec = await get(smUrl);
    const f = rec.final;
    if (f === undefined || f.status !== 200 || f.body === undefined) continue;
    if (HTML_TYPES.has(mediaType(f.contentType))) continue;
    const sm = parseSitemap(f.body, smUrl);
    if (!sm.ok) continue;
    for (const loc of sm.urls) {
      if (!URL.canParse(loc.trim())) continue;
      const u = new URL(loc.trim());
      if (bare(u.hostname) !== bare(start.hostname)) continue;
      const mapped = `${origin}${u.pathname}${u.search}`;
      if (sm.isIndex) queue.push(mapped);
      else {
        sitemapUrls++;
        seeds.push(mapped);
      }
    }
  }

  // Level-wise BFS, one request at a time. Sorted per level, start first.
  const startNorm = normalizeCrawlUrl(start.href).url;
  const seen = new Set<string>();
  const depthOf = new Map<string, number>([[startNorm, 0]]);
  const pages: CompetitorPage[] = [];
  const texts: { text: string[] }[] = [];
  let attempts = 0;
  let stoppedBy: CompetitorReport["stoppedBy"] = "done";
  let level: string[] = [startNorm];
  let levelNo = 0;
  const considered = [...new Set(seeds)]
    .sort(byString)
    .slice(0, MAX_SITEMAP_SEEDS);
  const pending = new Set<string>(considered);

  while (level.length > 0 && stoppedBy === "done") {
    const candidates = [
      ...new Set(level.map((u) => normalizeCrawlUrl(u).url)),
    ].sort(byString);
    const todo: string[] = [];
    for (const url of candidates) {
      if (seen.has(url)) continue;
      seen.add(url);
      const u = new URL(url);
      if (isAssetPath(u.pathname)) continue;
      if (url !== startNorm && normalizeCrawlUrl(url).query) continue;
      if (!allowed(u)) continue;
      todo.push(url);
    }
    const at = todo.indexOf(startNorm);
    if (at > 0) todo.unshift(...todo.splice(at, 1));

    const next: string[] = [];
    for (const url of todo) {
      if (attempts >= o.maxPages) {
        stoppedBy = "max-pages";
        break;
      }
      attempts++;
      const rec = await get(url);
      const why = failure(rec);
      if (why !== undefined) {
        addError(url, why);
        continue;
      }
      const f = rec.final;
      if (f === undefined || new URL(f.url).origin !== origin) continue;
      if (
        f.body === undefined ||
        !HTML_TYPES.has(mediaType(f.contentType ?? f.headers["content-type"]))
      )
        continue;
      const finalUrl = new URL(f.url);
      const finalNorm = normalizeCrawlUrl(f.url).url;
      if (finalNorm !== url) {
        // Same-host redirect: robots.txt applies to where we ended up.
        if (!allowed(finalUrl)) {
          addError(url, "redirected to a path disallowed by robots.txt");
          continue;
        }
        if (seen.has(finalNorm)) continue;
        seen.add(finalNorm);
      }
      try {
        const page = parsePage(f.body, finalUrl.pathname);
        const heads = (lvl: 1 | 2): string[] =>
          page.headings
            .filter((h) => h.level === lvl)
            .map((h) => clean(h.text))
            .filter((t) => t !== "")
            .slice(0, MAX_HEADINGS);
        const title = page.title === undefined ? "" : clean(page.title);
        const h1 = heads(1);
        const h2 = heads(2);
        pages.push({
          url: clean(finalUrl.href, 500),
          path: clean(finalUrl.pathname, 300),
          title: title === "" ? null : title,
          h1,
          h2,
          schemaTypes: schemaTypesOf(page),
          wordCount: page.wordCount,
          kind: kindOf(finalUrl.pathname, o.areaHints),
          depth: depthOf.get(url) ?? levelNo,
        });
        texts.push({ text: [title, ...h1, ...h2] });
        for (const l of page.links) {
          let abs: URL;
          try {
            abs = new URL(l.href.trim(), f.url);
          } catch {
            continue;
          }
          if (abs.origin !== origin) continue;
          const n = normalizeCrawlUrl(abs.href).url;
          if (!depthOf.has(n)) depthOf.set(n, levelNo + 1);
          next.push(n);
        }
      } catch {
        addError(url, "page could not be analyzed");
      }
    }
    if (stoppedBy !== "done") break;
    levelNo++;
    // Sitemap URLs join the level after the start page.
    for (const s of pending) {
      if (!depthOf.has(s)) depthOf.set(s, levelNo);
      next.push(s);
    }
    pending.clear();
    level = next;
  }
  return report(pages, texts, sitemapUrls, stoppedBy);
}
