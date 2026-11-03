import { describe, expect, it } from "vitest";
import { rule } from "../../../../src/rules/http/mixed-content.js";
import { html, load, page, runRule } from "./_util.js";

const H = "https://example.com";
const run = async (body: string, start = `${H}/`) =>
  runRule(rule, await load({ [start]: html(page("", body)) }, {}, start));

describe("http/mixed-content", () => {
  it("http image and script on an https page warn", async () => {
    const f = await run(
      '<img src="http://example.com/a.jpg" alt=""><script src="http://cdn.x/a.js"></script>',
    );
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe("warning");
  });
  it("does not flag a plain http link", async () => {
    expect(await run('<a href="http://other.com/">x</a>')).toEqual([]);
  });
  it("https resources are silent", async () => {
    expect(await run('<img src="https://example.com/a.jpg" alt="">')).toEqual(
      [],
    );
  });
  it("silent on a local host", async () => {
    const o = "https://127.0.0.1:5";
    expect(
      await run('<img src="http://example.com/a.jpg" alt="">', `${o}/`),
    ).toEqual([]);
  });
  it("silent on an http page", async () => {
    const o = "http://example.com";
    expect(
      await run('<img src="http://example.com/a.jpg" alt="">', `${o}/`),
    ).toEqual([]);
  });
});
