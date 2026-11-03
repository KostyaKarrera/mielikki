import { afterEach, describe, expect, it } from "vitest";
import { createFetcher } from "../../src/net/fetch.js";
import { analyzeCompetitor, clean } from "../../src/research/competitors.js";
import { scriptedFetcher } from "../support/fake-fetcher.js";
import {
  type Behaviors,
  serveDir,
  type TestServer,
} from "../support/server.js";

const FX = "tests/fixtures/research/competitor-site";
let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const real = (o: { timeoutMs?: number; maxBytes?: number } = {}) =>
  createFetcher({
    userAgent: "Mielikki/test",
    timeoutMs: o.timeoutMs ?? 5000,
    maxBytes: o.maxBytes ?? 1_000_000,
    maxHops: 5,
    concurrency: 1,
    delayMs: 0,
    allowRedirectHost: () => false,
  });
const opts = { maxPages: 30, language: "fi" as const, areaHints: [] };
const html = (title: string, body = ""): string =>
  `<!doctype html><html><head><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`;

describe("analyzeCompetitor", () => {
  it("competitors_extracts_structure", async () => {
    server = await serveDir(FX);
    const r = await analyzeCompetitor(server.url, real(), opts);
    expect(r.pages.map((p) => p.path)).toEqual([
      "/",
      "/alueet/loviisa/",
      "/alueet/porvoo/",
      "/palvelut/",
      "/palvelut/x/",
      "/yhteystiedot/",
    ]);
    expect(r.pagesAnalyzed).toBe(6);
    expect(r.sitemapUrls).toBe(6);
    expect(r.stoppedBy).toBe("done");
    const by = (p: string) => r.pages.find((x) => x.path === p);
    expect(by("/")?.schemaTypes).toEqual(["LocalBusiness"]);
    expect(by("/")?.kind).toBe("home");
    expect(by("/")?.depth).toBe(0);
    expect(by("/palvelut/x/")?.kind).toBe("service");
    expect(by("/alueet/loviisa/")?.kind).toBe("area");
    expect(by("/palvelut/x/")?.h1).toEqual(["Sähköasennus kotiin"]);
    expect(by("/palvelut/x/")?.h2).toEqual(["Hinta ja aikataulu"]);
    expect(r.urlPatterns).toContainEqual({ pattern: "/alueet/*", count: 2 });
    expect(r.terms.length).toBeGreaterThan(0);
    expect(r.terms[0]?.pages).toBeGreaterThanOrEqual(r.terms[1]?.pages ?? 0);
    expect(r.errors).toEqual([]);
  });

  it("area hints from config classify pages", async () => {
    const f = scriptedFetcher({
      "http://c.test/": {
        html: html("Koti", '<a href="/helsinki-sahkoasennus/">h</a>'),
      },
      "http://c.test/helsinki-sahkoasennus/": { html: html("Helsinki") },
    });
    const r = await analyzeCompetitor("http://c.test/", f, {
      ...opts,
      areaHints: ["Helsinki"],
    });
    expect(
      r.pages.find((p) => p.path === "/helsinki-sahkoasennus/")?.kind,
    ).toBe("area");
  });

  it("competitors_obeys_robots_always", async () => {
    server = await serveDir(FX);
    await analyzeCompetitor(server.url, real(), opts);
    expect(server.requests.some((p) => p.startsWith("/private"))).toBe(false);
    expect(server.requests[0]).toBe("/robots.txt");
    await server.close();

    server = await serveDir(FX, {
      dynamic: (p) =>
        p === "/robots.txt"
          ? { type: "text/plain", body: "User-agent: *\nDisallow: /\n" }
          : undefined,
    });
    const r = await analyzeCompetitor(server.url, real(), opts);
    expect(r.pagesAnalyzed).toBe(0);
    expect(r.errors.map((e) => e.message)).toContain("blocked by robots.txt");
    expect(server.requests).toEqual(["/robots.txt"]);
  });

  it("competitors_hostile_site", async () => {
    const b: Behaviors = {
      redirects: { "/gone": { status: 302, location: "http://localhost:9/x" } },
      extra: {
        "/big": { type: "text/html", body: html("big", "x".repeat(5000)) },
      },
      dynamic: (p) => {
        if (p === "/")
          return {
            body: html(
              "Etusivu\u0000\u0007 \u0001 ok",
              '<a href="/gone">g</a><a href="/big">b</a><a href="/t">t</a><a href="/a/">a</a>',
            ),
          };
        if (p === "/t") return { body: html("T".repeat(1000)) };
        if (p.startsWith("/a/"))
          return { body: html("loop", `<a href="${p}b/">n</a>`) };
        if (p === "/robots.txt") return { status: 404, body: "" };
        return undefined;
      },
    };
    server = await serveDir(FX, b);
    const r = await analyzeCompetitor(server.url, real({ maxBytes: 3000 }), {
      ...opts,
      maxPages: 12,
    });
    expect(r.stoppedBy).toBe("max-pages");
    expect(r.pagesAnalyzed).toBeLessThanOrEqual(12);
    expect(r.errors.some((e) => e.target.endsWith("/gone"))).toBe(true);
    expect(r.errors.some((e) => e.target.endsWith("/big"))).toBe(true);
    expect(server.requests.length).toBeLessThanOrEqual(14);
    expect(r.pages[0]?.title).toBe("Etusivu ok");
    const t = r.pages.find((p) => p.path === "/t");
    expect(t?.title?.length).toBe(300);
    for (const e of r.errors) expect(e.message.length).toBeLessThanOrEqual(200);
    expect(JSON.stringify(r)).not.toMatch(/\p{Cc}/u);
  });

  it("competitors_does_not_leave_host", async () => {
    const f = scriptedFetcher({
      "http://c.test/": {
        html: html(
          "Koti",
          '<a href="http://other.test/x">o</a><a href="//evil.test/">e</a><a href="/ok/">k</a>',
        ),
      },
      "http://c.test/sitemap.xml": {
        html: "<urlset><url><loc>http://evil.test/s</loc></url><url><loc>http://c.test/ok/</loc></url></urlset>",
        headers: { "content-type": "application/xml" },
      },
    });
    await analyzeCompetitor("http://c.test/", f, opts);
    expect(f.requested.every((u) => new URL(u).host === "c.test")).toBe(true);
    expect(f.requested).toContain("http://c.test/ok/");
  });

  it("competitors_deterministic", async () => {
    const script = {
      "http://c.test/": {
        html: html(
          "Koti",
          '<a href="/b/">b</a><a href="/a/">a</a><a href="/c/">c</a>',
        ),
      },
      "http://c.test/a/": { html: html("A") },
      "http://c.test/b/": { html: html("B") },
      "http://c.test/c/": { html: html("C") },
    };
    const run = async (d: number) =>
      JSON.stringify(
        await analyzeCompetitor(
          "http://c.test/",
          scriptedFetcher(script, {
            delayMs: (u) => (u.length * d) % 7,
          }),
          opts,
        ),
      );
    expect(await run(3)).toBe(await run(5));
  });

  it("competitors_partial_failure", async () => {
    server = await serveDir(FX, {
      extra: {
        "/palvelut/": { type: "text/html", body: "", stream: "stall" },
      },
    });
    const r = await analyzeCompetitor(
      server.url,
      real({ timeoutMs: 300 }),
      opts,
    );
    expect(r.pagesAnalyzed).toBe(5);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.target).toContain("/palvelut/");
  });

  it("robots is re-checked after a same-host redirect", async () => {
    server = await serveDir(FX, {
      redirects: { "/go": { status: 302, location: "/private/secret/" } },
      dynamic: (p) =>
        p === "/"
          ? { body: html("Koti", '<a href="/go">g</a>') }
          : p === "/sitemap.xml"
            ? { status: 404, body: "" }
            : p === "/robots.txt"
              ? {
                  type: "text/plain",
                  body: "User-agent: *\nDisallow: /private/\n",
                }
              : undefined,
    });
    const r = await analyzeCompetitor(server.url, real(), opts);
    expect(r.pages.map((p) => p.path)).toEqual(["/"]);
    expect(r.errors.map((e) => e.message)).toContain(
      "redirect into a path disallowed by robots.txt",
    );
    expect(r.terms.map((t) => t.term)).not.toContain("salainen");
  });

  it("a page whose extraction throws becomes an error entry", async () => {
    const ok = scriptedFetcher({
      "http://c.test/": {
        html: html("Koti", '<a href="/bad/">b</a><a href="/good/">g</a>'),
      },
      "http://c.test/good/": { html: html("Good") },
      "http://c.test/bad/": { html: html("Bad") },
    });
    const f = {
      async get(url: string) {
        const rec = await ok.get(url);
        if (url.endsWith("/bad/") && rec.final) {
          let n = 0;
          rec.final = {
            ...rec.final,
            get body(): string {
              if (n++ > 0) throw new Error("boom");
              return "<html></html>";
            },
          };
        }
        return rec;
      },
    };
    const r = await analyzeCompetitor("http://c.test/", f, opts);
    expect(r.pages.map((p) => p.path)).toEqual(["/", "/good/"]);
    expect(r.errors).toEqual([
      {
        source: "competitors",
        target: "http://c.test/bad/",
        message: "page could not be analyzed",
      },
    ]);
  });

  it("schemaTypes are capped at 20 distinct types of at most 100 chars", async () => {
    const types = Array.from(
      { length: 50000 },
      (_, i) => `T${i}${"x".repeat(200)}`,
    );
    const f = scriptedFetcher({
      "http://c.test/": {
        html: `<html><head><title>k</title><script type="application/ld+json">${JSON.stringify({ "@type": types })}</script></head><body><h1>k</h1></body></html>`,
      },
    });
    const r = await analyzeCompetitor("http://c.test/", f, opts);
    const st = r.pages[0]?.schemaTypes ?? [];
    expect(st).toHaveLength(20);
    expect(st.every((t) => t.length <= 100)).toBe(true);
  });

  it("robots answered with a refused redirect names the canonical host", async () => {
    server = await serveDir(FX, {
      redirects: {
        "/robots.txt": {
          status: 301,
          location: "http://localhost:9/robots.txt",
        },
      },
    });
    const r = await analyzeCompetitor(server.url, real(), opts);
    expect(r.pagesAnalyzed).toBe(0);
    expect(r.errors[0]?.message).toContain("redirects to localhost:9");
    expect(r.errors[0]?.message).toContain("pass the canonical URL");
    expect(server.requests).toEqual(["/robots.txt"]);
  });

  it("a redirect to an already crawled page does not duplicate it", async () => {
    const f = scriptedFetcher({
      "http://c.test/": {
        html: html("Koti", '<a href="/a/">a</a><a href="/b/">b</a>'),
      },
      "http://c.test/a/": { html: html("A") },
      "http://c.test/b/": {
        final: {
          url: "http://c.test/a/",
          status: 200,
          headers: { "content-type": "text/html" },
          contentType: "text/html",
          bytes: 1,
          body: html("A"),
        },
      },
    });
    const r = await analyzeCompetitor("http://c.test/", f, opts);
    expect(r.pages.map((p) => p.path)).toEqual(["/", "/a/"]);
  });

  it("clean strips format characters and never splits surrogate pairs", () => {
    expect(clean("a\u202Eb\u200Bc")).toBe("abc");
    const cut = clean("😀".repeat(400));
    expect(Array.from(cut)).toHaveLength(300);
    expect(cut).not.toContain("\uFFFD");
  });

  it("kind matches service/area words in any segment and hyphenated forms", async () => {
    const script: Record<string, { html: string }> = {};
    for (const u of [
      "/fi/palvelut/",
      "/palvelut-ja-hinnat/",
      "/fi/alueet/x/",
      "/muu/",
    ])
      script[`http://c.test${u}`] = { html: html(u) };
    script["http://c.test/"] = {
      html: html(
        "Koti",
        '<a href="/fi/palvelut/">a</a><a href="/palvelut-ja-hinnat/">b</a><a href="/fi/alueet/x/">c</a><a href="/muu/">d</a>',
      ),
    };
    const r = await analyzeCompetitor(
      "http://c.test/",
      scriptedFetcher(script),
      opts,
    );
    const k = Object.fromEntries(r.pages.map((p) => [p.path, p.kind]));
    expect(k).toMatchObject({
      "/fi/palvelut/": "service",
      "/palvelut-ja-hinnat/": "service",
      "/fi/alueet/x/": "area",
      "/muu/": "other",
    });
  });

  const rob = (body: string) => ({ type: "text/plain", body });

  it("redirect to the same hostname on another port is never requested", async () => {
    const other = await serveDir(FX);
    try {
      server = await serveDir(FX, {
        redirects: {
          "/go": { status: 302, location: `${other.url}/palvelut/` },
        },
        dynamic: (p) =>
          p === "/"
            ? { body: html("Koti", '<a href="/go">g</a>') }
            : p === "/sitemap.xml"
              ? { status: 404, body: "" }
              : undefined,
      });
      const r = await analyzeCompetitor(server.url, real(), opts);
      expect(other.requests).toEqual([]);
      expect(r.errors.some((e) => e.target.endsWith("/go"))).toBe(true);
      expect(r.pages.map((p) => p.path)).toEqual(["/"]);
    } finally {
      await other.close();
    }
  });

  it("scheme change is not followed", async () => {
    const f = scriptedFetcher({
      "http://c.test/": { html: html("Koti", '<a href="/s/">s</a>') },
      "http://c.test/s/": {
        final: {
          url: "http://c.test/s/",
          status: 301,
          headers: { location: "https://c.test/s/" },
          bytes: 0,
        },
      },
    });
    const r = await analyzeCompetitor("http://c.test/", f, opts);
    expect(f.requested).not.toContain("https://c.test/s/");
    expect(
      r.errors.some((e) => e.message.startsWith("redirect to https://")),
    ).toBe(true);
  });

  it("intermediate hops are robots-checked before they are requested", async () => {
    server = await serveDir(FX, {
      redirects: {
        "/go": { status: 302, location: "/private/x" },
        "/private/x": { status: 302, location: "/ok/" },
      },
      dynamic: (p) =>
        p === "/"
          ? { body: html("Koti", '<a href="/go">g</a>') }
          : p === "/robots.txt"
            ? rob("User-agent: *\nDisallow: /private/\n")
            : p === "/sitemap.xml"
              ? { status: 404, body: "" }
              : p === "/ok/"
                ? { body: html("Ok") }
                : undefined,
    });
    const r = await analyzeCompetitor(server.url, real(), opts);
    expect(server.requests).not.toContain("/private/x");
    expect(r.errors[0]?.message).toBe(
      "redirect into a path disallowed by robots.txt",
    );
  });

  it("same-origin redirect (/x -> /x/) is followed", async () => {
    server = await serveDir(FX, {
      redirects: { "/x": { status: 301, location: "/x/" } },
      dynamic: (p) =>
        p === "/"
          ? { body: html("Koti", '<a href="/x">x</a>') }
          : p === "/x/"
            ? { body: html("X") }
            : p === "/sitemap.xml"
              ? { status: 404, body: "" }
              : undefined,
    });
    const r = await analyzeCompetitor(server.url, real(), opts);
    expect(r.pages.map((p) => p.path)).toEqual(["/", "/x/"]);
    expect(r.errors).toEqual([]);
  });

  it("robots.txt redirecting to another port is unavailable", async () => {
    const other = await serveDir(FX);
    try {
      server = await serveDir(FX, {
        redirects: {
          "/robots.txt": { status: 301, location: `${other.url}/robots.txt` },
        },
      });
      const r = await analyzeCompetitor(server.url, real(), opts);
      expect(other.requests).toEqual([]);
      expect(r.pagesAnalyzed).toBe(0);
      expect(r.errors[0]?.message).toContain("redirects to 127.0.0.1:");
      expect(server.requests).toEqual(["/robots.txt"]);
    } finally {
      await other.close();
    }
  });
});

describe("analyzeCompetitor deep nesting", () => {
  it("competitors_skips_too_deep_page_and_continues", async () => {
    const f = scriptedFetcher({
      "http://c.test/": {
        html: html("Koti", '<a href="/deep/">d</a><a href="/ok/">o</a>'),
      },
      "http://c.test/deep/": {
        html: `<html><body>${"<div>".repeat(100_000)}</body></html>`,
      },
      "http://c.test/ok/": { html: html("Ok") },
    });
    const r = await analyzeCompetitor("http://c.test/", f, opts);
    expect(r.pages.map((p) => p.path)).toEqual(["/", "/ok/"]);
    expect(r.errors).toContainEqual(
      expect.objectContaining({
        message: "page too deeply nested (100002 > 1500)",
      }),
    );
  });
});

describe("analyzeCompetitor manual redirects", () => {
  const redir = (to: string | undefined, status = 302) => ({
    html: "",
    status,
    headers: to === undefined ? {} : { location: to },
  });
  const site = (extra: Record<string, ReturnType<typeof redir>>) =>
    scriptedFetcher({
      "http://c.test/": { html: html("Koti", '<a href="/r0">r</a>') },
      "http://c.test/final": { html: html("Final") },
      ...extra,
    });

  it("follows up to 5 hops", async () => {
    const f = site({
      "http://c.test/r0": redir("/r1"),
      "http://c.test/r1": redir("/r2"),
      "http://c.test/r2": redir("/r3"),
      "http://c.test/r3": redir("/r4"),
      "http://c.test/r4": redir("/final"),
    });
    const r = await analyzeCompetitor("http://c.test/", f, opts);
    expect(r.pages.map((p) => p.path)).toContain("/final");
    expect(r.errors).toEqual([]);
  });

  it("stops after more than 5 hops", async () => {
    const f = site({
      "http://c.test/r0": redir("/r1"),
      "http://c.test/r1": redir("/r2"),
      "http://c.test/r2": redir("/r3"),
      "http://c.test/r3": redir("/r4"),
      "http://c.test/r4": redir("/r5"),
      "http://c.test/r5": redir("/final"),
    });
    const r = await analyzeCompetitor("http://c.test/", f, opts);
    expect(r.pages.map((p) => p.path)).toEqual(["/"]);
    expect(r.errors.map((e) => e.message)).toContain("more than 5 redirects");
    expect(f.requested).not.toContain("http://c.test/final");
  });

  it("detects a redirect loop", async () => {
    const f = site({
      "http://c.test/r0": redir("/r1"),
      "http://c.test/r1": redir("/r0"),
    });
    const r = await analyzeCompetitor("http://c.test/", f, opts);
    expect(r.pages.map((p) => p.path)).toEqual(["/"]);
    expect(r.errors.map((e) => e.message)).toContain("redirect loop");
    // the loop is cut at the first repeat
    expect(f.requested.filter((u) => u.endsWith("/r0"))).toHaveLength(1);
  });

  it("garbage Location is an error, missing Location is not followed", async () => {
    const f = site({
      "http://c.test/r0": redir("http://[bad"),
    });
    const r = await analyzeCompetitor("http://c.test/", f, opts);
    expect(r.pages.map((p) => p.path)).toEqual(["/"]);
    expect(r.errors.map((e) => e.message)).toContain(
      "invalid redirect location",
    );

    const g = site({ "http://c.test/r0": redir(undefined) });
    const r2 = await analyzeCompetitor("http://c.test/", g, opts);
    expect(r2.pages.map((p) => p.path)).toEqual(["/"]);
    expect(g.requested.filter((u) => u.endsWith("/r0"))).toHaveLength(1);
    expect(r2.errors.map((e) => e.message)).toContain("HTTP 302");
  });
});

describe("analyzeCompetitor Crawl-delay", () => {
  const robots = (delay: string) => ({
    html: `User-agent: *\nCrawl-delay: ${delay}\n`,
    headers: { "content-type": "text/plain" },
  });
  const run = async (crawlDelay: string, delayMs: number) => {
    const f = scriptedFetcher({
      "http://c.test/robots.txt": robots(crawlDelay),
      "http://c.test/": { html: html("Koti", '<a href="/a/">a</a>') },
      "http://c.test/a/": { html: html("A") },
    });
    const sleeps: number[] = [];
    const r = await analyzeCompetitor("http://c.test/", f, {
      ...opts,
      delayMs,
      sleep: async (ms) => void sleeps.push(ms),
    });
    return { sleeps, r, f };
  };

  it("pauses so the gap is max(--delay, Crawl-delay)", async () => {
    const { sleeps, r } = await run("3", 1000);
    expect(r.pages).toHaveLength(2);
    expect(sleeps.length).toBeGreaterThanOrEqual(2);
    expect(new Set(sleeps)).toEqual(new Set([2000]));
  });

  it("caps Crawl-delay at 10 s", async () => {
    const { sleeps } = await run("60", 0);
    expect(new Set(sleeps)).toEqual(new Set([10_000]));
  });

  it("does nothing when --delay is already larger", async () => {
    const { sleeps } = await run("2", 5000);
    expect(sleeps).toEqual([]);
  });

  it("never sleeps before robots.txt itself", async () => {
    const { sleeps, f } = await run("3", 0);
    expect(f.requested[0]).toBe("http://c.test/robots.txt");
    expect(sleeps.length).toBe(f.requested.length - 1);
  });
});
