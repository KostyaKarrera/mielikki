import { describe, expect, it } from "vitest";
import { pageKey, resolveHref } from "../../src/model/url.js";
import { siteFrom } from "../helpers.js";

describe("pageKey", () => {
  it("pageKey variants", () => {
    for (const v of ["/a", "/a/", "/a.html", "/a/index.html", "/a/?x=1#h"])
      expect(pageKey(v)).toBe("/a/");
    expect(pageKey("/")).toBe("/");
    expect(pageKey("/index.html")).toBe("/");
  });
  it("percent-encoded and decoded non-ASCII give one key", () => {
    expect(pageKey("/palvelut/s%C3%A4hk%C3%B6/")).toBe("/palvelut/sähkö/");
    expect(pageKey("/palvelut/sähkö/")).toBe("/palvelut/sähkö/");
  });
  it("survives malformed escapes", () => {
    expect(pageKey("/a%E0%A4%A")).toBe("/a%E0%A4%A/");
  });
});

describe("resolveHref", () => {
  it("resolveHref absolute same host internal", () => {
    expect(resolveHref("https://x.fi/a", "/", "https://x.fi")).toEqual({
      internal: true,
      key: "/a/",
    });
    expect(resolveHref("https://other.fi/a", "/", "https://x.fi")).toEqual({
      internal: false,
      external: "https://other.fi/a",
    });
  });
  it("relative and root links", () => {
    expect(resolveHref("b", "/a/")).toEqual({ internal: true, key: "/a/b/" });
    expect(resolveHref("../b", "/a/c/")).toEqual({
      internal: true,
      key: "/a/b/",
    });
    expect(resolveHref("/b.html?q=1#z", "/a/")).toEqual({
      internal: true,
      key: "/b/",
    });
    expect(resolveHref("#top", "/a/")).toEqual({ internal: true, key: "/a/" });
  });
  it("mailto/tel/javascript are not internal and have no key", () => {
    for (const h of ["mailto:a@b.fi", "tel:+358", "javascript:void(0)"])
      expect(resolveHref(h, "/", "https://x.fi")).toEqual({ internal: false });
  });
  it("assets keep their file path", () => {
    expect(resolveHref("/img/s%C3%A4.jpg", "/a/")).toEqual({
      internal: true,
      key: "/img/sä.jpg",
    });
  });
  it("non-ASCII keys: link between encoded and decoded forms finds the page", async () => {
    const site = await siteFrom({
      "index.html": '<a href="/palvelut/s%C3%A4hk%C3%B6/">x</a>',
      "palvelut/sähkö/index.html": "<p>hi</p>",
    });
    expect(site.byKey.has("/palvelut/sähkö/")).toBe(true);
    const link = site.byKey.get("/")?.links[0];
    expect(link?.key).toBe("/palvelut/sähkö/");
    expect(site.depth.get("/palvelut/sähkö/")).toBe(1);
  });
});
