import { isLocalHost } from "../model/host.js";
import type { Asset, FetchRecord, Page, Site } from "../model/types.js";
import { pageKey, resolveHref } from "../model/url.js";
import type { Fetcher } from "../net/fetch.js";
import { isAssetPath } from "../net/policy.js";
import { PageUnparseableError, parsePageSafe } from "../parse/safe.js";

export const NOT_FOUND_PROBE = "/__mielikki_404__/";
const MAX_SLASH_PROBES = 10;
const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"]);

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function fileUrl(origin: string, key: string): string {
  return `${origin}${encodeURI(key)}`;
}

/**
 * The only off-origin URLs the crawler may request: the `http://` and the
 * `www.`/non-`www.` variants of the crawl host (always `follow:false`, never
 * followed). Empty for local hosts and IP addresses.
 */
export function formProbeUrls(startUrl: string): string[] {
  if (!URL.canParse(startUrl)) return [];
  const u = new URL(startUrl);
  if (isLocalHost(u.hostname) || /^[\d.]+$/.test(u.hostname)) return [];
  if (u.hostname.includes(":")) return []; // IPv6 literal
  const out: string[] = [];
  if (u.protocol === "https:") out.push(`http://${u.host}/`);
  const host = u.hostname.startsWith("www.")
    ? u.hostname.slice(4)
    : `www.${u.hostname}`;
  const port = u.port === "" ? "" : `:${u.port}`;
  out.push(`${u.protocol}//${host}${port}/`);
  return out;
}

/**
 * Same (already URL-encoded) path with the opposite trailing slash; undefined
 * for the root and for paths whose last segment has a file extension.
 */
export function slashVariant(pathname: string): string | undefined {
  if (/\.[^/.]+\/?$/.test(pathname)) return undefined;
  const other = pathname.endsWith("/")
    ? pathname.replace(/\/+$/, "")
    : `${pathname}/`;
  return other === "" || other === "/" ? undefined : other;
}

export async function loadAssets(
  site: Site,
  fetcher: Fetcher,
  max: number,
): Promise<void> {
  const origin = site.origin;
  if (origin === undefined) return;
  const keys = new Set<string>();
  const add = (href: string | undefined, from: string, fileOnly: boolean) => {
    if (href === undefined || href.trim() === "") return;
    const res = resolveHref(href, from, site.site);
    if (!res.internal || res.key === undefined) return;
    if (fileOnly && !isAssetPath(res.key)) return;
    keys.add(res.key);
  };
  for (const p of site.byKey.values()) {
    for (const img of p.images) if (img.key !== undefined) keys.add(img.key);
    for (const r of p.resources) add(r.src, p.key, false);
    // What a directory build has as files: og:image and linked files (PDF etc.).
    add(p.og["og:image"], p.key, false);
    for (const l of p.links) add(l.href, p.key, true);
  }
  for (const sm of site.sitemaps)
    for (const loc of sm.urls) add(loc, "/", true);
  // Pages are not assets: only file-like keys (with an extension) are requested.
  const chosen = [...keys]
    .filter((k) => !k.endsWith("/") && !site.byKey.has(k))
    .sort(byString)
    .slice(0, Math.max(0, max));

  const recs = await Promise.all(
    chosen.map(async (key) => {
      const url = fileUrl(origin, key);
      let rec = await fetcher.get(url, { method: "HEAD" });
      // Some servers (e.g. behind Cloudflare) reject HEAD with 403/405/501.
      const status = rec.final?.status;
      if (status === 403 || status === 405 || status === 501)
        rec = await fetcher.get(url, { method: "GET", wantBody: false });
      return rec;
    }),
  );
  // Stored in sorted key order, whatever the completion order was.
  chosen.forEach((key, i) => {
    const rec = recs[i] as FetchRecord;
    site.responses?.set(fileUrl(origin, key), rec);
    const f = rec.final;
    if (rec.stop !== undefined || f === undefined || f.status !== 200) return;
    const cl = Number.parseInt(f.headers["content-length"] ?? "", 10);
    const asset: Asset = {
      key,
      bytes: Number.isFinite(cl) && cl >= 0 ? cl : f.bytes,
      ext: /\.([^./]+)$/.exec(key)?.[1]?.toLowerCase() ?? "",
      headers: f.headers,
    };
    site.assets.set(key, asset);
  });
}

export async function runProbes(
  site: Site,
  fetcher: Fetcher,
  parseTimeoutMs?: number,
): Promise<void> {
  const origin = site.origin;
  const responses = site.responses;
  if (origin === undefined || responses === undefined) return;

  const probe = async (url: string): Promise<FetchRecord> => {
    const rec = await fetcher.get(url, { follow: false });
    return rec;
  };

  const urls: string[] = [`${origin}${NOT_FOUND_PROBE}`];
  // Requests to the config.site host are rewritten to the crawl host, so a
  // probe of that host would really probe the crawl host: never send it.
  const cfg = site.config.site;
  const siteOrigin =
    cfg !== undefined && URL.canParse(cfg) ? new URL(cfg).origin : undefined;
  urls.push(
    ...formProbeUrls(site.input.root).filter(
      (u) => new URL(u).origin !== siteOrigin,
    ),
  );
  const slashed = [...site.pages]
    .sort((a, b) => byString(a.key, b.key))
    .filter((p) => p.key !== "/")
    .flatMap((p) => {
      const path =
        p.url !== undefined ? new URL(p.url).pathname : encodeURI(p.key);
      const other = slashVariant(path);
      return other === undefined ? [] : [`${origin}${other}`];
    })
    .slice(0, MAX_SLASH_PROBES);
  urls.push(...slashed);

  const recs = await Promise.all(urls.map(probe));
  urls.forEach((url, i) => {
    responses.set(url, recs[i] as FetchRecord);
  });

  const f = recs[0]?.final;
  const ct = f?.contentType ?? f?.headers["content-type"] ?? "";
  if (
    f !== undefined &&
    f.status === 404 &&
    f.body?.trim() &&
    HTML_TYPES.has(ct.split(";")[0]?.trim().toLowerCase() ?? "")
  ) {
    let page: Page;
    try {
      page = await parsePageSafe(f.body, pageKey(NOT_FOUND_PROBE), undefined, {
        timeoutMs: parseTimeoutMs,
      });
    } catch (e) {
      if (!(e instanceof PageUnparseableError)) throw e;
      site.unparsed ??= [];
      site.unparsed.push({
        url: f.url,
        reason: e.reason,
        depth: e.depth,
      });
      return; // judged without the parsed body
    }
    page.status = f.status;
    page.headers = f.headers;
    page.url = f.url;
    for (const l of page.links) {
      const r = resolveHref(l.href, page.key, site.site);
      l.internal = r.internal;
      l.key = r.key;
    }
    for (const img of page.images) {
      const r =
        img.src === ""
          ? { internal: false }
          : resolveHref(img.src, page.key, site.site);
      img.key = r.internal ? r.key : undefined;
    }
    site.notFound = page;
  }
}
