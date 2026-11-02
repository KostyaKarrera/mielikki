import { describe, expect, it } from "vitest";
import { rule } from "../../../../src/rules/http/compression.js";
import { html, load, page, runRule } from "./_util.js";

const H = "https://example.com";
const big = page("", `<p>${"x".repeat(2000)}</p>`);
const run = async (
  headers: Record<string, string>,
  start = `${H}/`,
  body = big,
) => runRule(rule, await load({ [start]: html(body, headers) }, {}, start));

describe("http/compression", () => {
  it("uncompressed large HTML warns", async () => {
    const f = await run({});
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe("warning");
    expect(f[0]?.details?.count).toBe(1);
  });
  it.each(["gzip", "br", "zstd"])("%s is silent", async (enc) => {
    expect(await run({ "content-encoding": enc })).toEqual([]);
  });
  it("small HTML is silent", async () => {
    expect(await run({}, `${H}/`, page())).toEqual([]);
  });
  it("silent on 127.0.0.1", async () => {
    expect(await run({}, "http://127.0.0.1:5/")).toEqual([]);
  });
  it("aggregates into one finding with at most 5 sorted examples", async () => {
    const links = Array.from(
      { length: 7 },
      (_, i) => `<a href="/p${i}/">p</a>`,
    ).join("");
    const script: Record<string, ReturnType<typeof html>> = {
      [`${H}/`]: html(page("", `${links}<p>${"x".repeat(2000)}</p>`)),
    };
    for (let i = 0; i < 7; i++) script[`${H}/p${i}/`] = html(big);
    const f = await runRule(rule, await load(script, {}, `${H}/`));
    expect(f).toHaveLength(1);
    expect(f[0]?.details?.count).toBe(8);
    expect(f[0]?.details?.examples).toEqual([
      `${H}/`,
      `${H}/p0/`,
      `${H}/p1/`,
      `${H}/p2/`,
      `${H}/p3/`,
    ]);
  });
});
