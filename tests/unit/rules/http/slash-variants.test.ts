import { describe, expect, it } from "vitest";
import { rule } from "../../../../src/rules/http/slash-variants.js";
import { html, load, O, probe, redirect, runRule } from "./_util.js";

const base = { [`${O}/`]: html('<a href="/a/">a</a><a href="/b">b</a>') };
describe("http/slash-variants", () => {
  it("both forms 200 -> finding", async () => {
    const s = await load({
      ...base,
      [`${O}/a/`]: html("a"),
      [`${O}/b`]: html("b"),
      [`${O}/a`]: html("a"), // probe answers 200
    });
    const f = await runRule(rule, s);
    expect(f.map((x) => x.url)).toEqual([`${O}/a/`]);
  });
  it("opposite form redirecting (301) or 404 -> silent", async () => {
    const s = await load({
      ...base,
      [`${O}/a/`]: html("a"),
      [`${O}/b`]: html("b"),
      [`${O}/a`]: probe(`${O}/a`, 301, `${O}/a/`),
      [`${O}/b/`]: probe(`${O}/b/`, 301, `${O}/b`),
    });
    expect(await runRule(rule, s)).toEqual([]);
    const t = await load({
      ...base,
      [`${O}/a/`]: html("a"),
      [`${O}/b`]: html("b"),
    });
    expect(await runRule(rule, t)).toEqual([]);
  });
  it("is warning, not raised by launch", async () => {
    const s = await load({
      ...base,
      [`${O}/a/`]: html("a"),
      [`${O}/b`]: html("b"),
      [`${O}/a`]: html("a"),
    });
    expect(rule.meta.launchBlocking).toBe(false);
    expect((await runRule(rule, s, "launch"))[0]?.severity).toBe("warning");
  });
});

describe("http/slash-variants (crawled opposite forms)", () => {
  it("crawl-followed /a -> /a/ redirect is silent", async () => {
    const s = await load({
      [`${O}/`]: html('<a href="/a">a</a><a href="/a/">a</a>'),
      [`${O}/a`]: redirect(`${O}/a`, 301, `${O}/a/`),
      [`${O}/a/`]: html("a"),
    });
    expect(await runRule(rule, s)).toEqual([]);
  });
  it("both crawled forms genuinely 200 fires", async () => {
    const s = await load({
      [`${O}/`]: html('<a href="/a">a</a><a href="/a/">a</a>'),
      [`${O}/a`]: html("a1"),
      [`${O}/a/`]: html("a2"),
    });
    expect((await runRule(rule, s)).length).toBeGreaterThan(0);
  });
});
