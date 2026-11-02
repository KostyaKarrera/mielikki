import { describe, expect, it } from "vitest";
import { rule } from "../../../../src/rules/http/cache-headers.js";
import { html, load, page, runRule } from "./_util.js";

const img = (cc?: string) => ({
  final: {
    url: "",
    status: 200,
    headers: {
      "content-type": "image/png",
      ...(cc ? { "cache-control": cc } : {}),
    },
    bytes: 10,
  },
});
const run = async (origin: string, cc?: string) => {
  const script = {
    [`${origin}/`]: html(page("", '<img src="/a.png" alt="">')),
    [`${origin}/a.png`]: img(cc),
  };
  return runRule(rule, await load(script, {}, `${origin}/`));
};
const H = "https://example.com";

describe("http/cache-headers", () => {
  it("missing cache-control is info, one finding", async () => {
    const f = await run(H);
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe("info");
    expect(f[0]?.details?.examples).toEqual([`${H}/a.png`]);
  });
  it("short max-age is reported", async () => {
    expect(await run(H, "public, max-age=3600")).toHaveLength(1);
  });
  it("long max-age and immutable are silent", async () => {
    expect(await run(H, "public, max-age=31536000")).toEqual([]);
    expect(await run(H, "immutable")).toEqual([]);
  });
  it("silent on 127.0.0.1", async () => {
    expect(await run("http://127.0.0.1:5")).toEqual([]);
  });
});
