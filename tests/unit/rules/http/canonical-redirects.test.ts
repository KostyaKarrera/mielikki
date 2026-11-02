import { describe, expect, it } from "vitest";
import { rule as canonicalTarget } from "../../../../src/rules/crawl/canonical-target.js";
import { rule } from "../../../../src/rules/http/canonical-redirects.js";
import { html, load, O, page, redirect, runRule } from "./_util.js";

const canon = (href: string) => page(`<link rel="canonical" href="${href}">`);
const site = (pageKey: string, canonical: string, extra = {}, cfg = {}) =>
  load(
    {
      [`${O}/`]: html('<a href="/a/">a</a>'),
      [`${O}${pageKey}`]: html(canon(canonical)),
      ...extra,
    },
    cfg,
  );

describe("http/canonical-redirects", () => {
  it("canonical /a on page /a/ fires; error in launch", async () => {
    const s = await site("/a/", "/a");
    const f = await runRule(rule, s);
    expect(f.map((x) => x.url)).toEqual(["/a/"]);
    expect((await runRule(rule, s, "launch"))[0]?.severity).toBe("error");
  });
  it("case difference fires", async () => {
    // /A/ exists too, so crawl/canonical-target is silent and this rule explains the form difference
    const s = await site("/a/", "/A/", {
      [`${O}/`]: html('<a href="/a/">a</a><a href="/A/">A</a>'),
      [`${O}/A/`]: html(page()),
    });
    expect(await runRule(rule, s)).toHaveLength(1);
  });
  it("exact canonical and production-host canonical on localhost are silent", async () => {
    expect(await runRule(rule, await site("/a/", `${O}/a/`))).toEqual([]);
    const s = await site(
      "/a/",
      "https://example.fi/a/",
      {},
      { site: "https://example.fi" },
    );
    expect(await runRule(rule, s)).toEqual([]);
  });
  it("production-host canonical with a slash difference still fires", async () => {
    const s = await site(
      "/a/",
      "https://example.fi/a",
      {},
      { site: "https://example.fi" },
    );
    expect(await runRule(rule, s)).toHaveLength(1);
  });
  it("canonical to another existing page that redirects fires", async () => {
    const s = await load({
      [`${O}/`]: html('<a href="/a/">a</a><a href="/b/">b</a>'),
      [`${O}/a/`]: html(canon("/b")),
      [`${O}/b`]: redirect(`${O}/b`, 301, `${O}/b/`),
      [`${O}/b/`]: html(page()),
    });
    const f = await runRule(rule, s);
    expect(f.map((x) => x.url)).toEqual(["/a/"]);
  });
  it("is silent where crawl/canonical-target reports (missing target)", async () => {
    const s = await site("/a/", "/missing/");
    expect(await runRule(canonicalTarget, s)).toHaveLength(1);
    expect(await runRule(rule, s)).toEqual([]);
  });
  it("is silent without canonical or with an external one", async () => {
    expect(
      await runRule(rule, await site("/a/", "https://other.example/x/")),
    ).toEqual([]);
  });
});
