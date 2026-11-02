import { describe, expect, it } from "vitest";
import { NOT_FOUND_PROBE } from "../../../../src/load/probes.js";
import { rule } from "../../../../src/rules/http/soft-404.js";
import { html, load, O, page, runRule } from "./_util.js";

const withBody = (body: string, title = "Koti", lang?: "fi" | "sv" | "en") =>
  load(
    {
      [`${O}/`]: html(page(`<title>${title}</title>`, body)),
      [`${O}${NOT_FOUND_PROBE}`]: { html: "x", status: 404 },
    },
    lang ? { language: lang } : {},
  );

describe("http/soft-404", () => {
  it("probe answering 200 is an error and blocks launch", async () => {
    const site = await load({
      [`${O}/`]: html(page("<title>a</title>")),
      [`${O}${NOT_FOUND_PROBE}`]: html(page("<title>b</title>")),
    });
    const f = await runRule(rule, site, "dev");
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe("error");
    expect((await runRule(rule, site, "launch"))[0]?.severity).toBe("error");
  });
  it("a proper 404 probe is silent", async () => {
    expect(await runRule(rule, await withBody("<h1>Koti</h1>"))).toEqual([]);
  });
  it.each([
    ["fi", "<h1>Sivua ei löytynyt</h1>"],
    ["sv", "<h1>Sidan hittades inte!</h1>"],
    ["en", "<h1>Page not found.</h1>"],
  ] as const)("page-level match for %s is a warning", async (lang, h1) => {
    const f = await runRule(rule, await withBody(h1, "Koti", lang));
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe("warning");
  });
  it("matches a title segment and a bare 404", async () => {
    const t = await runRule(
      rule,
      await withBody("<h1>Koti</h1>", "Ei löytynyt | Firma", "fi"),
    );
    expect(t).toHaveLength(1);
    const n = await runRule(rule, await withBody("<h1>404</h1>", "Koti", "fi"));
    expect(n).toHaveLength(1);
  });
  it("does not match a phrase inside a longer sentence", async () => {
    expect(
      await runRule(
        rule,
        await withBody("<h1>Ei löytynyt maalle</h1>", "Koti", "fi"),
      ),
    ).toEqual([]);
  });
  it("checks all languages when none is configured", async () => {
    const f = await runRule(rule, await withBody("<h1>Page not found</h1>"));
    expect(f).toHaveLength(1);
  });
  it("ignores a phrase of another language when language is set", async () => {
    expect(
      await runRule(rule, await withBody("<h1>Page not found</h1>", "K", "fi")),
    ).toEqual([]);
  });
});
