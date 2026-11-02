import { parseConfig } from "../../../../src/config/schema.js";
import { type CrawlOptions, loadUrl } from "../../../../src/load/url.js";
import type { Site } from "../../../../src/model/types.js";
import { runRule } from "../../../helpers.js";
import {
  type ScriptEntry,
  scriptedFetcher,
} from "../../../support/fake-fetcher.js";

export const O = "http://127.0.0.1:5";
export const OPTS: CrawlOptions = {
  maxPages: 100,
  maxAssets: 100,
  respectRobots: true,
};
export const html = (
  body: string,
  headers?: Record<string, string>,
): ScriptEntry => (headers ? { html: body, headers } : { html: body });
export const page = (head = "", body = "<h1>x</h1>"): string =>
  `<html lang="fi"><head>${head}</head><body><main>${body}</main></body></html>`;
/** A 3xx answer as a followed redirect record (hops, then the final page). */
export const redirect = (
  from: string,
  status: number,
  to: string,
  finalBody = "<h1>t</h1>",
): ScriptEntry => ({
  hops: [{ url: from, status, location: to }],
  final: {
    url: to,
    status: 200,
    headers: { "content-type": "text/html" },
    bytes: 1,
    body: page("", finalBody),
  },
});
/** A probe answer (follow:false): the redirect itself is the final answer. */
export const probe = (
  url: string,
  status: number,
  location?: string,
): ScriptEntry => ({
  final: {
    url,
    status,
    headers: location ? { location } : {},
    bytes: 0,
  },
});

export async function load(
  script: Record<string, ScriptEntry>,
  config: Parameters<typeof parseConfig>[0] = {},
  start = `${O}/`,
  opts: Partial<CrawlOptions> = {},
): Promise<Site> {
  return loadUrl(start, parseConfig(config), scriptedFetcher(script), {
    ...OPTS,
    ...opts,
  });
}

export { runRule };
