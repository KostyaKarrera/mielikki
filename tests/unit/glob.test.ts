import { describe, expect, it } from "vitest";
import { matchGlob, matchPath } from "../../src/rules/glob.js";

describe("matchGlob", () => {
  it("* does not cross /, ** does", () => {
    expect(matchGlob("seo/*", "seo/title")).toBe(true);
    expect(matchGlob("seo/*", "seo/a/b")).toBe(false);
    expect(matchGlob("seo/**", "seo/a/b")).toBe(true);
    expect(matchGlob("**", "x/y")).toBe(true);
    expect(matchGlob("seo/title", "seo/title")).toBe(true);
    expect(matchGlob("a.b", "axb")).toBe(false);
  });
});

describe("matchPath", () => {
  it("/dir/* matches the directory and everything under it", () => {
    for (const k of ["/palvelut/", "/palvelut/a/", "/palvelut/a/b/"])
      expect(matchPath("/palvelut/*", k)).toBe(true);
    expect(matchPath("/palvelut/*", "/palvelutx/")).toBe(false);
    expect(matchPath("/palvelut/*", "/")).toBe(false);
  });
  it("patterns without * compare normalized keys", () => {
    expect(matchPath("/thanks", "/thanks/")).toBe(true);
    expect(matchPath("/thanks.html", "/thanks/")).toBe(true);
    expect(matchPath("/thanks/", "/thanks/x/")).toBe(false);
    expect(matchPath("/", "/")).toBe(true);
    expect(matchPath("/", "/a/")).toBe(false);
  });
  it("* in the middle crosses /", () => {
    expect(matchPath("/blog/*/draft/", "/blog/a/b/draft/")).toBe(true);
  });
});
