import { describe, expect, it } from "vitest";
import { isIndexable, isRobotsAllowed } from "../../src/model/indexable.js";
import type { Page } from "../../src/model/types.js";
import { siteFrom } from "../helpers.js";

describe("loadDir", () => {
  it("graph depth and inlinks", async () => {
    const site = await siteFrom({
      "index.html":
        '<nav><a href="/c/">c</a></nav><main><a href="/a/">a</a></main>',
      "a/index.html": '<main><a href="/b/">b</a></main>',
      "b/index.html": "<main>b</main>",
      "c/index.html": "<main>c</main>",
    });
    expect(site.depth.get("/b/")).toBe(2);
    expect(site.inlinks.get("/b/")).toEqual(["/a/"]);
    expect(site.inlinks.get("/c/")).toBeUndefined();
    expect(site.inlinksAll.get("/c/")).toEqual(["/"]);
    expect(site.pages.map((p) => p.key)).toEqual(["/", "/a/", "/b/", "/c/"]);
  });

  it("page nested too deeply is skipped and recorded, others load", async () => {
    const site = await siteFrom({
      "index.html": '<main><a href="/deep/">d</a></main>',
      "deep/index.html": `<main>${"<div>".repeat(100_000)}</main>`,
    });
    expect(site.pages.map((p) => p.key)).toEqual(["/"]);
    expect(site.unparsed).toEqual([
      { url: "deep/index.html", reason: "too-deep", depth: 1501 },
    ]);
  });

  it("404 separated", async () => {
    const site = await siteFrom({
      "index.html": "<p>x</p>",
      "404.html": "<p>nf</p>",
    });
    expect(site.notFound?.key).toBe("/404/");
    expect(site.pages.map((p) => p.key)).toEqual(["/"]);
  });

  it("collects assets, resolves link and image keys, detects site from canonical", async () => {
    const site = await siteFrom({
      "index.html":
        '<link rel="canonical" href="https://x.fi/"><a href="https://x.fi/a">a</a><a href="https://o.fi/">o</a><img src="/img/a.jpg">',
      "a.html": "<p>a</p>",
      "img/a.jpg": Buffer.from([1, 2, 3]),
    });
    expect(site.site).toBe("https://x.fi");
    const home = site.byKey.get("/");
    expect(home?.links.map((l) => [l.internal, l.key])).toEqual([
      [true, "/a/"],
      [false, undefined],
    ]);
    expect(home?.images[0]?.key).toBe("/img/a.jpg");
    expect(site.assets.get("/img/a.jpg")).toEqual({
      key: "/img/a.jpg",
      bytes: 3,
      ext: "jpg",
    });
    expect(site.byKey.has("/img/a.jpg")).toBe(false);
  });

  it("config.site wins over canonical", async () => {
    const site = await siteFrom(
      { "index.html": '<link rel="canonical" href="https://x.fi/">' },
      { site: "https://y.fi" },
    );
    expect(site.site).toBe("https://y.fi");
  });
});

describe("isIndexable", () => {
  const noindex = '<meta name="robots" content="noindex"><p>x</p>';
  it("prelaunch indexable", async () => {
    const files = { "index.html": noindex };
    const pre = await siteFrom(files, { prelaunch: true });
    expect(isIndexable(pre, pre.pages[0] as Page)).toBe(true);
    const live = await siteFrom(files);
    expect(isIndexable(live, live.pages[0] as Page)).toBe(false);
  });
  it("respects robots.txt unless prelaunch", async () => {
    const files = {
      "index.html": "<p>x</p>",
      "robots.txt": "User-agent: *\nDisallow: /",
    };
    const live = await siteFrom(files);
    expect(isRobotsAllowed(live, "/")).toBe(false);
    expect(isIndexable(live, live.pages[0] as Page)).toBe(false);
    const pre = await siteFrom(files, { prelaunch: true });
    expect(isIndexable(pre, pre.pages[0] as Page)).toBe(true);
  });
  it("excludes by glob and non-self canonical", async () => {
    const site = await siteFrom(
      {
        "index.html": "<p>x</p>",
        "thanks/index.html": "<p>t</p>",
        "a/index.html": '<link rel="canonical" href="https://x.fi/other/">',
        "b/index.html": '<link rel="canonical" href="https://x.fi/b">',
      },
      {
        site: "https://x.fi",
        exclude: { noindexExpected: ["/thanks"], ignore: [] },
      },
    );
    const idx = Object.fromEntries(
      site.pages.map((p) => [p.key, isIndexable(site, p)]),
    );
    expect(idx).toEqual({
      "/": true,
      "/a/": false,
      "/b/": true,
      "/thanks/": false,
    });
  });
});

describe("loadDir robustness", () => {
  it("malformed percent escapes in sitemap loc and robots Sitemap do not throw", async () => {
    const site = await siteFrom({
      "index.html": "<p>x</p>",
      "robots.txt":
        "Sitemap: https://x.fi/s%zz.xml\nSitemap: https://x.fi/idx.xml\n",
      "idx.xml": `<sitemapindex><sitemap><loc>https://x.fi/t%zz.xml</loc></sitemap></sitemapindex>`,
    });
    expect(site.sitemaps.map((s) => [s.file, s.ok])).toEqual([
      ["/s%zz.xml", false],
      ["/idx.xml", true],
      ["/t%zz.xml", false],
    ]);
  });

  it("files with literal percent sequences in their names key correctly", async () => {
    const site = await siteFrom({
      "a%20b.html": "<p>x</p>",
      "img/a%20b.jpg": Buffer.from([1]),
    });
    expect(site.pages.map((p) => p.key)).toEqual(["/a%20b/"]);
    expect(site.assets.has("/img/a%20b.jpg")).toBe(true);
  });

  it("/404/index.html is the not-found page, not a normal page", async () => {
    const site = await siteFrom({
      "index.html": "<p>x</p>",
      "404/index.html": "<p>nf</p>",
    });
    expect(site.notFound?.file).toBe("404/index.html");
    expect(site.pages.map((p) => p.key)).toEqual(["/"]);
    expect(site.byKey.has("/404/")).toBe(false);
  });

  it("exclude.ignore removes pages from site.pages but keeps them resolvable", async () => {
    const site = await siteFrom(
      {
        "index.html": '<main><a href="/vanha/">v</a></main>',
        "vanha/index.html": '<main><a href="/">home</a></main>',
      },
      { exclude: { noindexExpected: [], ignore: ["/vanha/*"] } },
    );
    expect(site.pages.map((p) => p.key)).toEqual(["/"]);
    expect(site.byKey.has("/vanha/")).toBe(true);
    expect(site.inlinks.get("/vanha/")).toEqual(["/"]);
    expect(site.inlinks.get("/")).toEqual(["/vanha/"]);
    expect(site.depth.get("/vanha/")).toBe(1);
  });

  it("skips symlinked files and directories (and cannot loop)", async () => {
    const { mkdtemp, mkdir, writeFile, symlink, rm } = await import(
      "node:fs/promises"
    );
    const os = await import("node:os");
    const path = await import("node:path");
    const { loadDir } = await import("../../src/load/dir.js");
    const { parseConfig } = await import("../../src/config/schema.js");
    const dir = await mkdtemp(path.join(os.tmpdir(), "mielikki-link-"));
    try {
      await mkdir(path.join(dir, "a"));
      await writeFile(path.join(dir, "index.html"), "<p>x</p>");
      await writeFile(path.join(dir, "a", "index.html"), "<p>a</p>");
      await symlink(path.join(dir, "index.html"), path.join(dir, "b.html"));
      await symlink(dir, path.join(dir, "a", "loop"));
      const site = await loadDir(dir, parseConfig({}));
      expect(site.pages.map((p) => p.key)).toEqual(["/", "/a/"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
