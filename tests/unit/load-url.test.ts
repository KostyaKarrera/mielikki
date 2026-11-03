import { describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config/schema.js";
import { UsageError } from "../../src/errors.js";
import { type CrawlOptions, loadUrl } from "../../src/load/url.js";
import { rule as orphan } from "../../src/rules/crawl/orphan.js";
import { rule as pageMissing } from "../../src/rules/targets/page-missing.js";
import { runRule } from "../helpers.js";
import { type ScriptEntry, scriptedFetcher } from "../support/fake-fetcher.js";

const O = "http://127.0.0.1:5";
const OPTS: CrawlOptions = {
  maxPages: 100,
  maxAssets: 100,
  respectRobots: true,
};

const html = (body: string, headers?: Record<string, string>): ScriptEntry =>
  headers ? { html: body, headers } : { html: body };
const xml = (body: string): ScriptEntry => ({
  html: body,
  headers: { "content-type": "application/xml" },
});
const urlset = (...locs: string[]): string =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;
const sitemapIndex = (...locs: string[]): string =>
  `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<sitemap><loc>${l}</loc></sitemap>`).join("")}</sitemapindex>`;

async function crawl(
  script: Record<string, ScriptEntry>,
  config: Parameters<typeof parseConfig>[0] = {},
  opts: Partial<CrawlOptions> = {},
  start = `${O}/`,
  delayMs?: (url: string) => number,
) {
  const fetcher = scriptedFetcher(script, delayMs ? { delayMs } : {});
  const site = await loadUrl(start, parseConfig(config), fetcher, {
    ...OPTS,
    ...opts,
  });
  return { site, fetcher };
}

describe("loadUrl", () => {
  it("(a) crawls internal links into a sorted page graph", async () => {
    const { site } = await crawl({
      [`${O}/`]: html(
        '<nav><a href="/b/">b</a></nav><main><a href="/a/">a</a><a href="https://elsewhere.fi/">x</a></main>',
      ),
      [`${O}/a/`]: html('<main><a href="c/">c</a><a href="/b/">b</a></main>'),
      [`${O}/b/`]: html("<main>b</main>"),
      [`${O}/a/c/`]: html("<main>c</main>"),
    });
    expect(site.input).toEqual({ kind: "url", root: `${O}/` });
    expect(site.origin).toBe(O);
    expect(site.site).toBe(O);
    expect(site.pages.map((p) => p.key)).toEqual(["/", "/a/", "/a/c/", "/b/"]);
    expect(site.inlinks.get("/b/")).toEqual(["/a/"]);
    expect(site.inlinksAll.get("/b/")).toEqual(["/", "/a/"]);
    expect(site.depth.get("/a/c/")).toBe(2);
    expect(site.depth.get("/b/")).toBe(1);
    const a = site.byKey.get("/a/");
    expect(a?.url).toBe(`${O}/a/`);
    expect(a?.status).toBe(200);
    expect(a?.headers?.["content-type"]).toBe("text/html; charset=utf-8");
    expect(site.assets.size).toBe(0);
    expect(site.notFound).toBeUndefined();
    expect(site.crawl).toEqual({ limitReached: false, skipped: [] });
  });

  it("(b) a redirect and its target give one page and two responses", async () => {
    const { site } = await crawl({
      [`${O}/`]: html('<a href="/a">a</a><a href="/a/">a/</a>'),
      [`${O}/a`]: {
        hops: [{ url: `${O}/a`, status: 301, location: "/a/" }],
        final: {
          url: `${O}/a/`,
          status: 200,
          headers: { "content-type": "text/html" },
          contentType: "text/html",
          bytes: 9,
          body: "<p>a</p>",
        },
      },
      [`${O}/a/`]: html("<p>a</p>"),
    });
    expect(site.pages.map((p) => p.key)).toEqual(["/", "/a/"]);
    expect(site.responses?.has(`${O}/a`)).toBe(true);
    expect(site.responses?.has(`${O}/a/`)).toBe(true);
    expect(site.responses?.get(`${O}/a`)?.hops).toHaveLength(1);
  });

  it("(b1) a start URL redirecting to another origin is a usage error", async () => {
    const H = "https://127.0.0.1:5";
    const p = crawl({
      [`${O}/`]: {
        hops: [{ url: `${O}/`, status: 301, location: `${H}/` }],
        final: {
          url: `${H}/`,
          status: 200,
          headers: { "content-type": "text/html" },
          contentType: "text/html",
          bytes: 1,
          body: '<a href="/a/">a</a>',
        },
      },
    });
    await expect(p).rejects.toThrow(UsageError);
    await expect(p).rejects.toThrow(
      `Start URL redirects to ${H}; check that URL instead`,
    );
  });

  it("(b1) a page redirecting to another origin is not a crawled page", async () => {
    const H = "https://127.0.0.1:5";
    const { site, fetcher } = await crawl({
      [`${O}/`]: html('<a href="/a/">a</a>'),
      [`${O}/a/`]: {
        hops: [{ url: `${O}/a/`, status: 301, location: `${H}/a/` }],
        final: {
          url: `${H}/a/`,
          status: 200,
          headers: { "content-type": "text/html" },
          contentType: "text/html",
          bytes: 1,
          body: '<a href="/b/">b</a>',
        },
      },
    });
    expect(site.pages.map((p) => p.key)).toEqual(["/"]);
    expect(fetcher.requested).not.toContain(`${O}/b/`);
  });

  it("(b2) a redirect target is not requested again on a later level", async () => {
    const { fetcher } = await crawl({
      [`${O}/`]: html('<a href="/a">a</a>'),
      [`${O}/a`]: {
        hops: [{ url: `${O}/a`, status: 301, location: "/a/" }],
        final: {
          url: `${O}/a/`,
          status: 200,
          headers: { "content-type": "text/html" },
          contentType: "text/html",
          bytes: 0,
          body: '<a href="/a/">self</a>',
        },
      },
    });
    expect(fetcher.requested.filter((u) => u === `${O}/a/`)).toEqual([]);
  });

  it("(c) RF3: links to config.site go to the crawl host, never to prod", async () => {
    const { site, fetcher } = await crawl(
      {
        [`${O}/robots.txt`]: {
          html: "User-agent: *\nAllow: /\nSitemap: https://prod.fi/sitemap.xml\n",
          headers: { "content-type": "text/plain" },
        },
        [`${O}/sitemap.xml`]: xml(urlset("https://prod.fi/d/")),
        [`${O}/`]: html(
          '<a href="https://prod.fi/b/">b</a><a href="https://other.fi/x/">x</a><a href="/c/">c</a>',
        ),
        [`${O}/b/`]: html("<p>b</p>"),
        [`${O}/c/`]: html("<p>c</p>"),
        [`${O}/d/`]: html("<p>d</p>"),
      },
      { site: "https://prod.fi" },
    );
    expect(fetcher.requested).toContain(`${O}/b/`);
    expect(fetcher.requested).toContain(`${O}/d/`);
    expect(fetcher.requested).toContain(`${O}/sitemap.xml`);
    expect(fetcher.requested.filter((u) => !u.startsWith(`${O}/`))).toEqual([]);
    expect(fetcher.requested.some((u) => u.includes("prod.fi"))).toBe(false);
    expect(site.site).toBe("https://prod.fi");
    expect(site.pages.map((p) => p.key)).toEqual(["/", "/b/", "/c/", "/d/"]);
    expect(site.byKey.get("/")?.links[0]).toMatchObject({
      internal: true,
      key: "/b/",
    });
  });

  it("(d) RF1: an endless link space stops at maxPages", async () => {
    const script: Record<string, ScriptEntry> = {
      [`${O}/`]: html('<a href="/p1/">1</a>'),
    };
    for (let n = 1; n < 1000; n++) {
      script[`${O}/p${n}/`] = html(
        `<a href="/p${n + 1}/">p</a><a href="/q${n + 1}/">q</a>`,
      );
      script[`${O}/q${n}/`] = html("<p>q</p>");
    }
    const { site, fetcher } = await crawl(script, {}, { maxPages: 5 });
    expect(site.pages.map((p) => p.key)).toEqual([
      "/",
      "/p1/",
      "/p2/",
      "/p3/",
      "/q2/",
    ]);
    expect(site.crawl?.limitReached).toBe(true);
    expect(site.crawl?.skipped).toEqual([`${O}/p4/`, `${O}/q3/`, `${O}/q4/`]);
    expect(fetcher.requested).not.toContain(`${O}/q3/`);
  });

  it("keeps every skipped URL, sorted (http/crawl-limit lists the first 50)", async () => {
    const links = Array.from(
      { length: 80 },
      (_, i) => `<a href="/s${String(i).padStart(2, "0")}/">s</a>`,
    ).join("");
    const { site } = await crawl(
      { [`${O}/`]: html(links) },
      {},
      { maxPages: 1 },
    );
    const skipped = site.crawl?.skipped ?? [];
    expect(skipped).toHaveLength(80);
    expect(skipped).toEqual([...skipped].sort());
    expect(skipped[0]).toBe(`${O}/s00/`);
  });

  it("(e) X-Robots-Tag tokens join robotsMeta", async () => {
    const { site } = await crawl({
      [`${O}/`]: html('<meta name="robots" content="nofollow"><p>x</p>', {
        "X-Robots-Tag": "NoIndex, nofollow, otherbot: noimageindex",
      }),
    });
    expect(site.byKey.get("/")?.robotsMeta).toEqual(["nofollow", "noindex"]);
  });

  it("non-200 and non-HTML answers stay in responses only", async () => {
    const { site } = await crawl({
      [`${O}/`]: html(
        '<a href="/gone/">g</a><a href="/feed/">f</a><a href="/slow/">s</a>',
      ),
      [`${O}/feed/`]: xml("<rss/>"),
      [`${O}/slow/`]: { stop: "timeout", detail: "exceeded" },
    });
    expect(site.pages.map((p) => p.key)).toEqual(["/"]);
    expect([...(site.responses?.keys() ?? [])]).toEqual(
      expect.arrayContaining([`${O}/gone/`, `${O}/feed/`, `${O}/slow/`]),
    );
  });

  it("5xx pages are not pages", async () => {
    const { site } = await crawl({
      [`${O}/`]: html('<a href="/err/">e</a>'),
      [`${O}/err/`]: { html: "<p>boom</p>", status: 500 },
    });
    expect(site.pages.map((p) => p.key)).toEqual(["/"]);
    expect(site.responses?.get(`${O}/err/`)?.final?.status).toBe(500);
  });

  it("(f) sitemap index expands; a listed 404 is not ok; default 404 is silent", async () => {
    const { site } = await crawl({
      [`${O}/`]: html("<p>home</p>"),
      [`${O}/sitemap-index.xml`]: xml(
        sitemapIndex(`${O}/sm-pages.xml`, `${O}/sm-missing.xml`),
      ),
      [`${O}/sm-pages.xml`]: xml(urlset(`${O}/from-sitemap/`)),
      [`${O}/from-sitemap/`]: html("<p>s</p>"),
    });
    expect(site.robots).toBeUndefined();
    expect(site.responses?.get(`${O}/robots.txt`)?.final?.status).toBe(404);
    expect(
      site.sitemaps.map((s) => [s.file, s.ok, s.isIndex, s.error]),
    ).toEqual([
      [`${O}/sitemap-index.xml`, true, true, undefined],
      [`${O}/sm-pages.xml`, true, false, undefined],
      [`${O}/sm-missing.xml`, false, false, "HTTP 404"],
    ]);
    expect(site.pages.map((p) => p.key)).toEqual(["/", "/from-sitemap/"]);
  });

  it("a robots-listed sitemap that stops reports the stop reason", async () => {
    const { site } = await crawl({
      [`${O}/robots.txt`]: {
        html: `Sitemap: ${O}/sm.xml\nSitemap: https://foreign.fi/sm.xml\n`,
        headers: { "content-type": "text/plain" },
      },
      [`${O}/sm.xml`]: { stop: "too-large", detail: "big" },
      [`${O}/`]: html("<p>home</p>"),
    });
    expect(site.robots?.sitemaps).toHaveLength(2);
    expect(site.sitemaps.map((s) => [s.file, s.ok, s.error])).toEqual([
      [`${O}/sm.xml`, false, "too-large"],
      [
        "https://foreign.fi/sm.xml",
        false,
        "listed on another host, not fetched",
      ],
    ]);
  });

  it("(g) runs with different completion orders give an identical Site", async () => {
    const script: Record<string, ScriptEntry> = {
      [`${O}/`]: html(
        '<a href="/z/">z</a><a href="/a/">a</a><a href="/m">m</a><a href="/k/?q=1">k</a>',
      ),
      [`${O}/sitemap.xml`]: xml(urlset(`${O}/y/`, `${O}/b/`)),
      [`${O}/a/`]: html('<a href="/n/">n</a><a href="/z/">z</a>'),
      [`${O}/z/`]: html('<a href="/n/">n</a>'),
      [`${O}/n/`]: html("<p>n</p>"),
      [`${O}/y/`]: html("<p>y</p>"),
      [`${O}/b/`]: html("<p>b</p>"),
      [`${O}/m`]: html("<p>m</p>"),
    };
    // Delays by position in the sorted URL list: ascending in one run, reversed in the other,
    // so the fetcher answers each batch in opposite completion orders.
    const urls = Object.keys(script).sort();
    const rank = (u: string): number => {
      const i = urls.indexOf(u);
      return i < 0 ? urls.length : i;
    };
    const snap = async (delayMs: (url: string) => number) => {
      const { site, fetcher } = await crawl(
        script,
        {},
        { maxPages: 6 },
        `${O}/`,
        delayMs,
      );
      return {
        requested: fetcher.requested,
        json: JSON.stringify({
          pages: site.pages,
          responses: [...(site.responses?.keys() ?? [])],
          crawl: site.crawl,
          depth: [...site.depth],
          inlinks: [...site.inlinks],
          inlinksAll: [...site.inlinksAll],
        }),
      };
    };
    const up = await snap((u) => 2 * rank(u));
    const down = await snap((u) => 2 * (urls.length - rank(u)));
    expect(down.json).toBe(up.json);
    expect(down.requested).toEqual(up.requested);
  });

  it("(h) URLs with a query are not requested and are skipped", async () => {
    const { site, fetcher } = await crawl({
      [`${O}/`]: html('<a href="/a/?x=1#f">a</a><a href="/img/a.jpg">i</a>'),
    });
    expect(fetcher.requested).not.toContain(`${O}/a/?x=1`);
    // A linked file is not crawled as a page; it is only HEAD-checked as an asset.
    expect(
      fetcher.calls
        .filter((c) => c.url === `${O}/img/a.jpg`)
        .map((c) => c.o.method),
    ).toEqual(["HEAD"]);
    expect(site.crawl?.skipped).toEqual([`${O}/a/?x=1`]);
    expect(site.crawl?.limitReached).toBe(false);
  });

  it("respectRobots: the start URL is fetched even when robots.txt disallows /", async () => {
    const { site, fetcher } = await crawl({
      [`${O}/robots.txt`]: {
        html: "User-agent: *\nDisallow: /\n",
        headers: { "content-type": "text/plain; charset=utf-8" },
      },
      [`${O}/`]: html('<a href="/a/">a</a>'),
      [`${O}/a/`]: html("<p>a</p>"),
    });
    expect(fetcher.requested).toContain(`${O}/`);
    expect(fetcher.requested).not.toContain(`${O}/a/`);
    expect(site.pages.map((p) => p.key)).toEqual(["/"]);
    expect(site.crawl?.skipped).toEqual([`${O}/a/`]);
  });

  it("respectRobots: disallowed URLs are skipped, not requested", async () => {
    const script: Record<string, ScriptEntry> = {
      [`${O}/robots.txt`]: {
        html: "User-agent: *\nDisallow: /private/\n",
        headers: { "content-type": "text/plain; charset=utf-8" },
      },
      [`${O}/`]: html('<a href="/private/">p</a><a href="/open/">o</a>'),
      [`${O}/private/`]: html("<p>p</p>"),
      [`${O}/open/`]: html("<p>o</p>"),
    };
    const on = await crawl(script);
    expect(on.fetcher.requested).not.toContain(`${O}/private/`);
    expect(on.site.crawl?.skipped).toEqual([`${O}/private/`]);
    expect(on.site.robots?.isAllowed("/private/", "*")).toBe(false);
    const off = await crawl(script, {}, { respectRobots: false });
    expect(off.fetcher.requested).toContain(`${O}/private/`);
  });

  it("exclude.ignore pages are crawled and linked but not in pages", async () => {
    const { site } = await crawl(
      {
        [`${O}/`]: html('<a href="/hidden/">h</a>'),
        [`${O}/hidden/`]: html('<a href="/deep/">d</a>'),
        [`${O}/deep/`]: html("<p>d</p>"),
      },
      { exclude: { noindexExpected: [], ignore: ["/hidden/"] } },
    );
    expect(site.pages.map((p) => p.key)).toEqual(["/", "/deep/"]);
    expect(site.byKey.has("/hidden/")).toBe(true);
    expect(site.depth.get("/deep/")).toBe(2);
  });

  it("detects site from canonicals when config.site is unset", async () => {
    const { site } = await crawl({
      [`${O}/`]: html('<link rel="canonical" href="https://x.fi/"><p>x</p>'),
    });
    expect(site.site).toBe("https://x.fi");
  });

  it("rejects bad start URLs", async () => {
    await expect(crawl({}, {}, {}, "ftp://a.fi/")).rejects.toThrow();
  });
});

describe("loadUrl: sitemaps on another host", () => {
  it("a robots-listed sitemap on another host is not fetched and says so", async () => {
    const { site, fetcher } = await crawl({
      [`${O}/robots.txt`]: {
        html: "User-agent: *\nAllow: /\nSitemap: https://cdn.example/sitemap.xml\n",
        headers: { "content-type": "text/plain; charset=utf-8" },
      },
      [`${O}/`]: html("<p>x</p>"),
    });
    expect(fetcher.requested.some((u) => u.includes("cdn.example"))).toBe(
      false,
    );
    const sm = site.sitemaps.find((s) => s.file.includes("cdn.example"));
    expect(sm?.error).toBe("listed on another host, not fetched");
  });
});

describe("loadUrl: configured targets are seeded into the crawl", () => {
  const target = (url: string) => ({
    targets: { pages: [{ url, primary: "x" }] },
  });
  const script = {
    [`${O}/`]: html("<main>home</main>"),
    [`${O}/palvelut/`]: html("<main>palvelut</main>"),
  };

  it("an unlinked, un-sitemapped target answering 200 is an orphan, not missing", async () => {
    const { site } = await crawl(script, target("/palvelut/"));
    expect(await runRule(pageMissing, site)).toEqual([]);
    expect((await runRule(orphan, site)).map((f) => f.url)).toEqual([
      "/palvelut/",
    ]);
  });

  it("a target answering 404 is still missing", async () => {
    const { site } = await crawl(script, target("/puuttuu/"));
    expect((await runRule(pageMissing, site)).map((f) => f.url)).toEqual([
      "/puuttuu/",
    ]);
  });

  it("an absolute site-host target is mapped to the crawl host", async () => {
    const { site, fetcher } = await crawl(script, {
      site: "https://example.fi",
      ...target("https://example.fi/palvelut/"),
    });
    expect(await runRule(pageMissing, site)).toEqual([]);
    expect(fetcher.requested).toContain(`${O}/palvelut/`);
    for (const u of fetcher.requested) expect(new URL(u).origin).toBe(O);
  });

  it("a target on a foreign host is never requested", async () => {
    const { fetcher } = await crawl(script, target("https://elsewhere.fi/x/"));
    for (const u of fetcher.requested) expect(new URL(u).origin).toBe(O);
  });

  it("--max-pages 1 still requests the start URL when a smaller URL is seeded", async () => {
    const { site, fetcher } = await crawl(
      {
        ...script,
        [`${O}/sitemap.xml`]: xml(urlset(`${O}/aaa/`)),
        [`${O}/aaa/`]: html("<main>a</main>"),
        [`${O}/start/`]: html("<main>s</main>"),
      },
      target("/palvelut/"),
      { maxPages: 1 },
      `${O}/start/`,
    );
    expect(fetcher.requested).toContain(`${O}/start/`);
    expect(site.byKey.has("/start/")).toBe(true);
    expect(fetcher.requested).not.toContain(`${O}/aaa/`);
  });
});

describe("loadUrl deep nesting", () => {
  it("skips a too deeply nested page, records it, and keeps crawling", async () => {
    const { site } = await crawl(
      {
        [`${O}/`]: html(
          '<main><a href="/deep/">d</a><a href="/ok/">o</a></main>',
        ),
        [`${O}/deep/`]: html(`<main>${"<div></x>".repeat(20_000)}</main>`),
        [`${O}/ok/`]: html("<main>ok</main>"),
      },
      {},
      { parseTimeoutMs: 500 },
    );
    expect(site.pages.map((p) => p.key)).toEqual(["/", "/ok/"]);
    expect(site.unparsed).toEqual([
      { url: `${O}/deep/`, reason: "too-deep", depth: 1501 },
    ]);
  });
});

describe("loadUrl unparseable pages", () => {
  const b = Array.from({ length: 1400 }, (_, i) => `<b a${i}>`).join("");
  const blowup = `<div>${b}${"</div><div>x".repeat(3000)}`;
  it("a page the worker cannot parse is recorded and the crawl continues", async () => {
    const { site } = await crawl(
      {
        [`${O}/`]: html(
          '<main><a href="/bad/">b</a><a href="/ok/">o</a></main>',
        ),
        [`${O}/bad/`]: html(blowup),
        [`${O}/ok/`]: html("<main>ok</main>"),
      },
      {},
      { parseTimeoutMs: 400 },
    );
    expect(site.pages.map((p) => p.key)).toEqual(["/", "/ok/"]);
    expect(site.unparsed).toHaveLength(1);
    expect(site.unparsed?.[0]?.url).toBe(`${O}/bad/`);
    expect(["timeout", "memory"]).toContain(site.unparsed?.[0]?.reason);
  });
});
