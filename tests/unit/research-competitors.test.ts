import { afterEach, describe, expect, it } from "vitest";
import { createFetcher } from "../../src/net/fetch.js";
import { analyzeCompetitor } from "../../src/research/competitors.js";
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
});
