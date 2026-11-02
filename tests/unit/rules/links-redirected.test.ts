import { describe, expect, it } from "vitest";
import { rule } from "../../../src/rules/links/redirected.js";
import { rule as trailingSlash } from "../../../src/rules/links/trailing-slash.js";
import { html, load, O, redirect, runRule } from "./http/_util.js";

describe("links/redirected", () => {
  it("100 pages linking one redirecting URL give one finding with the sources", async () => {
    const script: Record<string, ReturnType<typeof html>> = {};
    const links = Array.from(
      { length: 100 },
      (_, i) => `<a href="/p${i}/">p</a>`,
    ).join("");
    script[`${O}/`] = html(links);
    for (let i = 0; i < 100; i++)
      script[`${O}/p${i}/`] = html('<a href="/old/">o</a>');
    script[`${O}/old/`] = redirect(`${O}/old/`, 301, `${O}/new/`);
    const f = await runRule(
      rule,
      await load(script, {}, `${O}/`, { maxPages: 300 }),
    );
    expect(f).toHaveLength(1);
    expect(f[0]?.url).toBe(`${O}/old/`);
    expect(f[0]?.details?.pages).toHaveLength(100);
    expect(f[0]?.severity).toBe("warning");
  });
  it("302 and non-redirecting targets are silent; not raised by launch", async () => {
    const s = await load({
      [`${O}/`]: html('<a href="/t/">t</a><a href="/ok/">o</a>'),
      [`${O}/t/`]: redirect(`${O}/t/`, 302, `${O}/t2/`),
      [`${O}/ok/`]: html("ok"),
    });
    expect(await runRule(rule, s)).toEqual([]);
    expect(rule.meta.launchBlocking).toBe(false);
  });
  it("is silent for a link that links/trailing-slash already reports", async () => {
    const script = {
      [`${O}/`]: html('<a href="/a">a</a>'),
      [`${O}/a`]: redirect(`${O}/a`, 301, `${O}/a/`),
      [`${O}/a/`]: html("a"),
    };
    const s = await load(script, { input: { trailingSlash: "always" } });
    expect(await runRule(trailingSlash, s)).toHaveLength(1);
    expect(await runRule(rule, s)).toEqual([]);
    // without the policy the redirect is reported
    expect(await runRule(rule, await load(script))).toHaveLength(1);
  });
});
