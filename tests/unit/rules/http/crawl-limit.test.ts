import { describe, expect, it } from "vitest";
import { rule } from "../../../../src/rules/http/crawl-limit.js";
import { html, load, O, runRule } from "./_util.js";

const script = {
  [`${O}/`]: html('<a href="/a/">a</a><a href="/b/">b</a>'),
  [`${O}/a/`]: html("a"),
  [`${O}/b/`]: html("b"),
};
describe("http/crawl-limit", () => {
  it("reports info with the skipped count, never raised by launch", async () => {
    const s = await load(script, {}, `${O}/`, { maxPages: 2 });
    for (const profile of ["dev", "launch"] as const) {
      const f = await runRule(rule, s, profile);
      expect(f).toHaveLength(1);
      expect(f[0]?.severity).toBe("info");
      expect(f[0]?.message).toContain("1 URL(s)");
    }
    expect(rule.meta.launchBlocking).toBe(false);
  });
  it("is silent without the limit", async () => {
    expect(await runRule(rule, await load(script))).toEqual([]);
  });
});
