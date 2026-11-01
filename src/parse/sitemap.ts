import { XMLParser, XMLValidator } from "fast-xml-parser";

export interface SitemapInfo {
  file: string;
  ok: boolean;
  error?: string;
  urls: string[];
  isIndex: boolean;
}

function locs(node: unknown): string[] {
  const items = Array.isArray(node) ? node : node === undefined ? [] : [node];
  return items
    .map((i) => (i as { loc?: unknown } | null)?.loc)
    .filter(
      (l): l is string | number =>
        typeof l === "string" || typeof l === "number",
    )
    .map((l) => String(l).trim());
}

export function parseSitemap(xml: string, file: string): SitemapInfo {
  const fail = (error: string): SitemapInfo => ({
    file,
    ok: false,
    error,
    urls: [],
    isIndex: false,
  });
  const valid = XMLValidator.validate(xml);
  if (valid !== true) return fail(valid.err.msg);
  const doc = new XMLParser({ removeNSPrefix: true }).parse(xml) as Record<
    string,
    unknown
  >;
  const urlset = doc.urlset as { url?: unknown } | undefined;
  const index = doc.sitemapindex as { sitemap?: unknown } | undefined;
  if (urlset !== undefined)
    return { file, ok: true, urls: locs(urlset?.url), isIndex: false };
  if (index !== undefined)
    return { file, ok: true, urls: locs(index?.sitemap), isIndex: true };
  return fail("root element is neither <urlset> nor <sitemapindex>");
}
