import { describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config/schema.js";
import {
  formProbeUrls,
  NOT_FOUND_PROBE,
  slashVariant,
} from "../../src/load/probes.js";
import { type CrawlOptions, loadUrl } from "../../src/load/url.js";
import type { Site } from "../../src/model/types.js";
import { rule as brokenInternal } from "../../src/rules/links/broken-internal.js";
import { type ScriptEntry, scriptedFetcher } from "../support/fake-fetcher.js";

const O = "http://127.0.0.1:5";
const OPTS: CrawlOptions = {
  maxPages: 100,
  maxAssets: 100,
  respectRobots: true,
};
const html = (body: string): ScriptEntry => ({ html: body });
const asset = (headers: Record<string, string>, status = 200): ScriptEntry => ({
  final: { url: "", status, headers, bytes: 7 },
});

async function run(
  script: Record<string, ScriptEntry>,
  start = `${O}/`,
  opts: Partial<CrawlOptions> = {},
  respond?: Parameters<typeof scriptedFetcher>[1],
) {
  const fetcher = scriptedFetcher(script, respond);
  const site = await loadUrl(start, parseConfig({}), fetcher, {
    ...OPTS,
    ...opts,
  });
  return { site, fetcher };
}

function brokenInternalLink(site: Site): boolean {
  let n = 0;
  for (const page of site.pages)
    (
      brokenInternal as unknown as { checkPage(p: unknown, c: unknown): void }
    ).checkPage(page, { site, report: () => n++ });
  return n > 0;
}

describe("loadAssets", () => {
  it("stores size from content-length with headers; skips non-200", async () => {
    const { site } = await run({
      [`${O}/`]: html(
        '<main><img src="/a.jpg" alt="x"><img src="/gone.png" alt="y"><a href="/gone.png">l</a></main><script src="/app.js"></script>',
      ),
      [`${O}/a.jpg`]: asset({
        "content-length": "123456",
        "content-type": "image/jpeg",
      }),
      [`${O}/app.js`]: asset({ "content-type": "text/javascript" }),
    });
    expect(site.assets.get("/a.jpg")).toEqual({
      key: "/a.jpg",
      bytes: 123456,
      ext: "jpg",
      headers: { "content-length": "123456", "content-type": "image/jpeg" },
    });
    expect(site.assets.get("/app.js")?.bytes).toBe(7);
    expect(site.assets.has("/gone.png")).toBe(false);
    expect(site.responses?.get(`${O}/gone.png`)?.final?.status).toBe(404);
    expect([...site.assets.keys()]).toEqual(["/a.jpg", "/app.js"]);
    expect(brokenInternalLink(site)).toBe(true);
  });

  it("retries a 405/501 HEAD as GET without body", async () => {
    const { fetcher, site } = await run(
      { [`${O}/`]: html('<img src="/a.jpg" alt="x">') },
      `${O}/`,
      {},
      {
        respond: (url, o) =>
          url === `${O}/a.jpg`
            ? o.method === "HEAD"
              ? asset({}, 405)
              : asset({ "content-length": "9" })
            : undefined,
      },
    );
    const calls = fetcher.calls.filter((c) => c.url === `${O}/a.jpg`);
    expect(calls.map((c) => c.o)).toEqual([
      { method: "HEAD" },
      { method: "GET", wantBody: false },
    ]);
    expect(site.assets.get("/a.jpg")?.bytes).toBe(9);
  });

  it("takes only the first max keys in sorted order", async () => {
    const { site } = await run(
      {
        [`${O}/`]: html(
          '<img src="/c.jpg"><img src="/a.jpg"><img src="/b.jpg">',
        ),
      },
      `${O}/`,
      { maxAssets: 2 },
      { delayMs: (u) => (u.endsWith("a.jpg") ? 20 : 0) },
    );
    expect(
      [...(site.responses?.keys() ?? [])].filter((k) => k.endsWith(".jpg")),
    ).toEqual([`${O}/a.jpg`, `${O}/b.jpg`]);
  });
});

describe("runProbes", () => {
  it("records the 404 probe; HTML 404 becomes site.notFound; 200 is just recorded", async () => {
    const a = await run({
      [`${O}/`]: html("<main>x</main>"),
      [`${O}${NOT_FOUND_PROBE}`]: {
        html: "<title>Ei</title><main>404</main>",
        status: 404,
      },
    });
    expect(a.site.notFound?.title).toBe("Ei");
    const b = await run({
      [`${O}/`]: html("<main>x</main>"),
      [`${O}${NOT_FOUND_PROBE}`]: html("<main>soft</main>"),
    });
    expect(b.site.notFound).toBeUndefined();
    expect(b.site.responses?.get(`${O}${NOT_FOUND_PROBE}`)?.final?.status).toBe(
      200,
    );
    expect(
      b.fetcher.calls.find((c) => c.url.endsWith(NOT_FOUND_PROBE))?.o,
    ).toEqual({ follow: false });
  });

  it("runs probes also when the page limit was reached, not counting them", async () => {
    const { site, fetcher } = await run(
      {
        [`${O}/`]: html('<a href="/a/">a</a><a href="/b/">b</a>'),
        [`${O}/a/`]: html("a"),
        [`${O}/b/`]: html("b"),
      },
      `${O}/`,
      { maxPages: 2 },
    );
    expect(site.crawl?.limitReached).toBe(true);
    expect(site.pages).toHaveLength(2);
    expect(fetcher.requested).toContain(`${O}${NOT_FOUND_PROBE}`);
  });

  it("sends no http:// or www probes on a local host", async () => {
    const { fetcher } = await run({ [`${O}/`]: html("x") });
    expect(fetcher.requested.every((u) => u.startsWith(O))).toBe(true);
  });

  it("sends http:// and www probes on a public host, without following Location", async () => {
    const H = "https://example.fi";
    const { fetcher, site } = await run(
      {
        [`${H}/`]: html("x"),
        "http://example.fi/": {
          final: {
            url: "http://example.fi/",
            status: 301,
            headers: { location: "https://example.fi/" },
            bytes: 0,
          },
        },
        "https://www.example.fi/": {
          final: {
            url: "https://www.example.fi/",
            status: 301,
            headers: { location: "https://other.example/" },
            bytes: 0,
          },
        },
      },
      `${H}/`,
    );
    const probes = fetcher.calls.filter((c) => !c.url.startsWith(`${H}/`));
    expect(probes.map((c) => c.url).sort()).toEqual([
      "http://example.fi/",
      "https://www.example.fi/",
    ]);
    expect(probes.every((c) => c.o.follow === false)).toBe(true);
    expect(fetcher.requested.some((u) => u.includes("other.example"))).toBe(
      false,
    );
    expect(site.responses?.get("https://www.example.fi/")?.final?.status).toBe(
      301,
    );
  });

  it("probes the opposite trailing slash, at most 10, not for / or files", async () => {
    const links = Array.from(
      { length: 12 },
      (_, i) => `<a href="/p${String(i).padStart(2, "0")}/">x</a>`,
    ).join("");
    const script: Record<string, ScriptEntry> = {
      [`${O}/`]: html(links + '<a href="/noslash">n</a>'),
    };
    for (let i = 0; i < 12; i++)
      script[`${O}/p${String(i).padStart(2, "0")}/`] = html("p");
    script[`${O}/noslash`] = html("n");
    const { fetcher } = await run(script);
    const slash = fetcher.requested.filter(
      (u) =>
        /\/(p\d\d|noslash)\/?$/.test(u) &&
        fetcher.calls.find((c) => c.url === u)?.o.follow === false,
    );
    expect([...slash].sort()).toEqual(
      [
        `${O}/noslash/`,
        ...Array.from({ length: 9 }, (_, i) => `${O}/p0${i}`),
      ].sort(),
    );
    expect(slash).toContain(`${O}/noslash/`);
    expect(slash).toContain(`${O}/p00`);
    expect(fetcher.requested).not.toContain(O);
    expect(fetcher.requested).not.toContain(`${O}/p11`);
  });

  it("slashVariant toggles the slash, never for root or file paths", () => {
    expect(slashVariant("/palvelut/")).toBe("/palvelut");
    expect(slashVariant("/palvelut")).toBe("/palvelut/");
    expect(slashVariant("/")).toBeUndefined();
    expect(slashVariant("/x.pdf")).toBeUndefined();
    expect(slashVariant("/docs/page.html")).toBeUndefined();
    expect(slashVariant("/v1.2/")).toBeUndefined();
    expect(slashVariant("/%C3%A4%20b/")).toBe("/%C3%A4%20b");
  });

  it("probes /palvelut for /palvelut/ and encodes non-ASCII paths", async () => {
    const { fetcher } = await run({
      [`${O}/`]: html(
        '<a href="/palvelut/">p</a><a href="/palvelut/sähkö/">s</a><a href="/ä b/">a</a>',
      ),
      [`${O}/palvelut/`]: html("p"),
      [`${O}/palvelut/s%C3%A4hk%C3%B6/`]: html("s"),
      [`${O}/%C3%A4%20b/`]: html("a"),
    });
    const probes = fetcher.calls
      .filter((c) => c.o.follow === false && !c.url.includes("__mielikki"))
      .map((c) => c.url)
      .sort();
    expect(probes).toEqual(
      [
        `${O}/%C3%A4%20b`,
        `${O}/palvelut`,
        `${O}/palvelut/s%C3%A4hk%C3%B6`,
      ].sort(),
    );
  });

  it("does not probe the slash variant of a crawled page whose path has an extension", async () => {
    const { fetcher, site } = await run({
      [`${O}/`]: html('<a href="/docs/page.html">d</a>'),
      [`${O}/docs/page.html`]: html("d"),
    });
    expect(site.pages.map((p) => p.url)).toContain(`${O}/docs/page.html`);
    expect(
      fetcher.requested.filter((u) => u.includes("/docs/page.html")),
    ).toEqual([`${O}/docs/page.html`]);
  });
});

describe("guard", () => {
  it("formProbeUrls is the only off-origin allowance and is empty for local hosts", () => {
    expect(formProbeUrls("https://example.fi/a/")).toEqual([
      "http://example.fi/",
      "https://www.example.fi/",
    ]);
    expect(formProbeUrls("https://www.example.fi/")).toEqual([
      "http://www.example.fi/",
      "https://example.fi/",
    ]);
    expect(formProbeUrls("http://localhost:4321/")).toEqual([]);
    expect(formProbeUrls("http://8.8.8.8/")).toEqual([]);
  });

  it("requests never leave the crawl host except the two probe URLs", async () => {
    const H = "https://example.fi";
    const { fetcher } = await run(
      {
        [`${H}/`]: html(
          '<a href="https://evil.example/x/">e</a><img src="https://evil.example/i.jpg"><a href="https://www.example.fi/y/">w</a>',
        ),
      },
      `${H}/`,
    );
    const off = fetcher.requested.filter((u) => !u.startsWith(`${H}/`));
    expect(off.sort()).toEqual([
      "http://example.fi/",
      "https://www.example.fi/",
    ]);
  });
});
