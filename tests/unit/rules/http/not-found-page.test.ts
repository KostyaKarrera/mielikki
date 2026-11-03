import { describe, expect, it } from "vitest";
import { NOT_FOUND_PROBE } from "../../../../src/load/probes.js";
import { rule } from "../../../../src/rules/http/not-found-page.js";
import { html, load, O, page, runRule } from "./_util.js";

const run = async (body: string) =>
  runRule(
    rule,
    await load({
      [`${O}/`]: html(page()),
      [`${O}${NOT_FOUND_PROBE}`]: { html: body, status: 404 },
    }),
  );
const pad = `<p>${"Sivua ei löydy, mutta apua on tarjolla. ".repeat(20)}</p>`;

describe("http/not-found-page", () => {
  it("bare body is info", async () => {
    const f = await run("<h1>404</h1>");
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe("info");
  });
  it("large body without link to / is info", async () => {
    expect(await run(`<html><body>${pad}</body></html>`)).toHaveLength(1);
  });
  it("large body with a link to / is silent", async () => {
    expect(
      await run(`<html><body>${pad}<a href="/">Etusivu</a></body></html>`),
    ).toEqual([]);
  });
  it("silent when the probe is not a 404", async () => {
    const site = await load({
      [`${O}/`]: html(page()),
      [`${O}${NOT_FOUND_PROBE}`]: html("x"),
    });
    expect(await runRule(rule, site)).toEqual([]);
  });
});
