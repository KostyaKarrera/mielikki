import type { Fetched, FetchRecord } from "../../src/model/types.js";
import type { Fetcher } from "../../src/net/fetch.js";

export type ScriptEntry =
  | Partial<FetchRecord>
  | { html: string; status?: number; headers?: Record<string, string> };

function fetched(
  url: string,
  body: string,
  status: number,
  extra: Record<string, string> = {},
): Fetched {
  const headers: Record<string, string> = {
    "content-type": "text/html; charset=utf-8",
  };
  for (const [k, v] of Object.entries(extra)) headers[k.toLowerCase()] = v;
  const f: Fetched = {
    url,
    status,
    headers,
    bytes: Buffer.byteLength(body),
    body,
  };
  if (headers["content-type"]) f.contentType = headers["content-type"];
  return f;
}

/**
 * Fetcher answering from a script keyed by exact URL; unknown URLs give 404.
 * Does not follow redirects or apply mapUrl: records are returned as scripted.
 * `delayMs` delays individual answers, to vary completion order between runs.
 */
export function scriptedFetcher(
  script: Record<string, ScriptEntry>,
  opts: { delayMs?(url: string): number } = {},
): Fetcher & { requested: string[] } {
  const requested: string[] = [];
  return {
    requested,
    async get(url) {
      requested.push(url);
      const delay = opts.delayMs?.(url) ?? 0;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      const entry = script[url];
      if (entry === undefined)
        return { requested: url, hops: [], final: fetched(url, "", 404) };
      if ("html" in entry)
        return {
          requested: url,
          hops: [],
          final: fetched(url, entry.html, entry.status ?? 200, entry.headers),
        };
      return { hops: [], ...structuredClone(entry), requested: url };
    },
  };
}
