import { NOT_FOUND_PROBE } from "../../load/probes.js";
import type { SiteRule } from "../types.js";

const MIN_BYTES = 512;

export const rule: SiteRule = {
  meta: {
    id: "http/not-found-page",
    title: "404 page is bare or has no way back",
    category: "http",
    severity: "info",
    scope: "site",
    inputs: ["url"],
    launchBlocking: false,
    fix: "Give the 404 page a helpful message and a link to the home page.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/http-network-errors",
  },
  checkSite(ctx) {
    const { site } = ctx;
    if (site.origin === undefined) return;
    const url = `${site.origin}${NOT_FOUND_PROBE}`;
    const f = site.responses?.get(url)?.final;
    if (f === undefined || f.status !== 404) return;
    const bytes = f.body !== undefined ? Buffer.byteLength(f.body) : f.bytes;
    const linksHome =
      site.notFound?.links.some((l) => l.internal && l.key === "/") ?? false;
    if (bytes >= MIN_BYTES && linksHome) return;
    ctx.report({
      url,
      message:
        bytes < MIN_BYTES
          ? `The 404 page is only ${bytes} bytes`
          : "The 404 page has no link to the home page",
      details: { bytes, linksHome },
    });
  },
};
