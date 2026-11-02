import { describe, expect, it } from "vitest";
import { rule } from "../../../../src/rules/http/redirect-chain.js";
import { html, load, O, page, runRule } from "./_util.js";

const hop = (url: string, to: string) => ({ url, status: 301, location: to });
const fin = (url: string) => ({
  url,
  status: 200,
  headers: { "content-type": "text/html" },
  bytes: 1,
  body: page(),
});

describe("http/redirect-chain", () => {
  const links = '<a href="/a">a</a><a href="/one">o</a>';
  it("warns on 2+ redirects and stays silent on one", async () => {
    const s = await load({
      [`${O}/`]: html(links),
      [`${O}/a`]: {
        hops: [hop(`${O}/a`, `${O}/b`), hop(`${O}/b`, `${O}/c/`)],
        final: fin(`${O}/c/`),
      },
      [`${O}/one`]: {
        hops: [hop(`${O}/one`, `${O}/z/`)],
        final: fin(`${O}/z/`),
      },
    });
    const f = await runRule(rule, s);
    expect(f.map((x) => [x.url, x.severity])).toEqual([[`${O}/a`, "warning"]]);
  });
  it("loop A->B->A and too-many-redirects are errors", async () => {
    const s = await load({
      [`${O}/`]: html('<a href="/a">a</a><a href="/m">m</a>'),
      [`${O}/a`]: {
        hops: [hop(`${O}/a`, `${O}/b`), hop(`${O}/b`, `${O}/a`)],
        stop: "redirect-loop",
      },
      [`${O}/m`]: {
        hops: [hop(`${O}/m`, `${O}/n`)],
        stop: "too-many-redirects",
      },
    });
    const f = await runRule(rule, s);
    expect(f.map((x) => x.severity)).toEqual(["error", "error"]);
  });
  it("is not raised by launch", async () => {
    expect(rule.meta.launchBlocking).toBe(false);
    const s = await load({
      [`${O}/`]: html('<a href="/a">a</a>'),
      [`${O}/a`]: {
        hops: [hop(`${O}/a`, `${O}/b`), hop(`${O}/b`, `${O}/c/`)],
        final: fin(`${O}/c/`),
      },
    });
    expect((await runRule(rule, s, "launch"))[0]?.severity).toBe("warning");
  });
});
