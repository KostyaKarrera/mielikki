import { describe, expect, it } from "vitest";
import { rule } from "../../../../src/rules/http/https-redirect.js";
import { html, load, probe, runRule } from "./_util.js";

const S = "https://example.fi/";
const run = async (
  p?: ReturnType<typeof probe>,
  profile: "dev" | "launch" = "dev",
) =>
  runRule(
    rule,
    await load(
      { [S]: html("x"), ...(p ? { "http://example.fi/": p } : {}) },
      {},
      S,
    ),
    profile,
  );

describe("http/https-redirect", () => {
  it("is silent for 301/308 to https same path", async () => {
    expect(
      await run(probe("http://example.fi/", 301, "https://example.fi/")),
    ).toEqual([]);
    expect(
      await run(probe("http://example.fi/", 308, "https://example.fi/")),
    ).toEqual([]);
  });
  it("fires for 302, 200, wrong target and no answer", async () => {
    expect(
      await run(probe("http://example.fi/", 302, "https://example.fi/")),
    ).toHaveLength(1);
    expect(await run(probe("http://example.fi/", 200))).toHaveLength(1);
    expect(
      await run(probe("http://example.fi/", 301, "http://example.fi/x")),
    ).toHaveLength(1);
    expect(await run({ stop: "network" } as never)).toHaveLength(1);
  });
  it("is an error in launch; silent for local hosts (no probe)", async () => {
    expect(
      (await run(probe("http://example.fi/", 200), "launch"))[0]?.severity,
    ).toBe("error");
    const s = await load(
      { "http://127.0.0.1:5/": html("x") },
      {},
      "http://127.0.0.1:5/",
    );
    expect(await runRule(rule, s)).toEqual([]);
  });
});
