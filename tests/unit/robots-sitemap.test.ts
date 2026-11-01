import { describe, expect, it } from "vitest";
import { parseRobots } from "../../src/parse/robots.js";
import { parseSitemap } from "../../src/parse/sitemap.js";
import { siteFrom } from "../helpers.js";

const urlset = (...locs: string[]) =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;

describe("robots", () => {
  it("robots disallow all", () => {
    const r = parseRobots("User-agent: *\nDisallow: /");
    expect(r.disallowsAll("Googlebot")).toBe(true);
    expect(r.isAllowed("/a/", "Googlebot")).toBe(false);
  });
  it("partial disallow and sitemaps", () => {
    const r = parseRobots(
      "User-agent: *\nDisallow: /admin/\nSitemap: https://x.fi/sitemap.xml",
      "https://x.fi",
    );
    expect(r.disallowsAll("Googlebot")).toBe(false);
    expect(r.isAllowed("/admin/x", "Googlebot")).toBe(false);
    expect(r.isAllowed("/a/", "Googlebot")).toBe(true);
    expect(r.sitemaps).toEqual(["https://x.fi/sitemap.xml"]);
  });
});

describe("sitemap", () => {
  it("parses urlset", () => {
    const s = parseSitemap(
      urlset("https://x.fi/", "https://x.fi/a/"),
      "/sitemap.xml",
    );
    expect(s).toMatchObject({
      ok: true,
      isIndex: false,
      urls: ["https://x.fi/", "https://x.fi/a/"],
    });
  });
  it("sitemap invalid xml -> ok false", () => {
    const s = parseSitemap("<urlset><url></urlset>", "/sitemap.xml");
    expect(s.ok).toBe(false);
    expect(s.error).toBeTruthy();
  });
  it("rejects unknown root", () => {
    expect(parseSitemap("<foo/>", "/s.xml").ok).toBe(false);
  });
  it("sitemap index expands", async () => {
    const site = await siteFrom({
      "index.html": "<p>x</p>",
      "robots.txt": "Sitemap: https://x.fi/sitemap-index.xml\n",
      "sitemap-index.xml": `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://x.fi/s1.xml</loc></sitemap><sitemap><loc>https://x.fi/missing.xml</loc></sitemap></sitemapindex>`,
      "s1.xml": urlset("https://x.fi/"),
    });
    expect(site.sitemaps.map((s) => [s.file, s.ok])).toEqual([
      ["/sitemap-index.xml", true],
      ["/s1.xml", true],
      ["/missing.xml", false],
    ]);
  });
  it("falls back to default sitemap locations", async () => {
    const site = await siteFrom({ "sitemap.xml": urlset("https://x.fi/") });
    expect(site.sitemaps).toHaveLength(1);
  });
});
