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
      expect(f[0]?.message).toContain("1 discovered URL(s)");
    }
    expect(rule.meta.launchBlocking).toBe(false);
  });
  it("lists at most 50 skipped URLs but counts them all", async () => {
    const links = Array.from(
      { length: 60 },
      (_, i) => `<a href="/s${String(i).padStart(2, "0")}/">s</a>`,
    ).join("");
    const s = await load({ [`${O}/`]: html(links) }, {}, `${O}/`, {
      maxPages: 1,
    });
    const f = await runRule(rule, s);
    expect(f[0]?.message).toContain("60 discovered URL(s)");
    expect(f[0]?.message).toContain("(first 50 listed)");
    const listed = (f[0]?.details ?? {}) as { skipped?: string[] };
    expect(listed.skipped).toHaveLength(50);
  });
  it("is silent without the limit", async () => {
    expect(await runRule(rule, await load(script))).toEqual([]);
  });
});
