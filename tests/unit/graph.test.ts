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

  it("detects the site from canonicals", () => {
    const p = parsePage(
      '<link rel="canonical" href="https://x.fi/a/">',
      pageKey("/a/"),
    );
    expect(detectSite([p])).toBe("https://x.fi");
  });
});
