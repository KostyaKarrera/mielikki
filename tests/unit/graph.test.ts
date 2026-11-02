import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config/schema.js";
import { loadDir } from "../../src/load/dir.js";
import { buildSiteGraph, detectSite } from "../../src/load/graph.js";
import { pageKey } from "../../src/model/url.js";
import { parsePage } from "../../src/parse/page.js";

const GOOD = path.resolve("tests/fixtures/sites/good/dist");

describe("buildSiteGraph", () => {
  it("matches loadDir inlinks/depth on the good fixture", async () => {
    const config = parseConfig({});
    const site = await loadDir(GOOD, config);
    const pages = [...site.byKey.values()].map((p) =>
      parsePage(p.html, p.key, p.file),
    );
    const nf = site.notFound
      ? parsePage(site.notFound.html, site.notFound.key, site.notFound.file)
      : undefined;
    const g = buildSiteGraph({
      pages,
      notFound: nf,
      siteUrl: site.site,
      config,
    });
    expect(g.inlinks).toEqual(site.inlinks);
    expect(g.inlinksAll).toEqual(site.inlinksAll);
    expect(g.depth).toEqual(site.depth);
    expect([...g.byKey.keys()]).toEqual([...site.byKey.keys()]);
    expect(g.depth.size).toBeGreaterThan(1);
  });

  it("computes inlinks, depth and dedup on hand-built pages", () => {
    const config = parseConfig({});
    const mk = (key: string, body: string) =>
      parsePage(`<html><body>${body}</body></html>`, key);
    const root = mk(
      "/",
      '<main><a href="/a/">a</a></main><footer><a href="/b/">b</a></footer>',
    );
    const a = mk(
      "/a/",
      '<main><a href="/b/">b</a><a href="/a/">self</a></main>',
    );
    const dup = mk("/a/", '<main><a href="/z/">z</a></main>');
    const b = mk("/b/", "<main>b</main>");
    const orphan = mk("/orphan/", '<main><a href="/b/">b</a></main>');
    const nf = mk("/404.html", '<main><a href="/only-nf/">x</a></main>');
    const g = buildSiteGraph({
      pages: [root, a, dup, b, orphan],
      notFound: nf,
      config,
    });
    expect(g.unique).toEqual([root, a, b, orphan]);
    expect(g.byKey.get("/a/")).toBe(a);
    expect(Object.fromEntries(g.depth)).toEqual({ "/": 0, "/a/": 1, "/b/": 1 });
    expect(Object.fromEntries(g.inlinks)).toEqual({
      "/a/": ["/"],
      "/b/": ["/a/", "/orphan/"],
    });
    expect(Object.fromEntries(g.inlinksAll)).toEqual({
      "/a/": ["/"],
      "/b/": ["/", "/a/", "/orphan/"],
    });
    expect(g.depth.has("/orphan/")).toBe(false);
    expect(nf.links[0]?.internal).toBe(true);
    expect(nf.links[0]?.key).toBe("/only-nf/");
    expect(g.inlinksAll.has("/only-nf/")).toBe(false);
  });

  it("detects the site from canonicals", () => {
    const p = parsePage(
      '<link rel="canonical" href="https://x.fi/a/">',
      pageKey("/a/"),
    );
    expect(detectSite([p])).toBe("https://x.fi");
  });
});
