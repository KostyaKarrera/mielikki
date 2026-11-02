import { describe, expect, it } from "vitest";
import { rule } from "../../../../src/rules/http/host-variant.js";
import { html, load, probe, runRule } from "./_util.js";

const S = "https://example.fi/";
const W = "https://www.example.fi/";
const run = async (
  p: Parameters<typeof load>[0][string],
  profile: "dev" | "launch" = "dev",
  start = S,
) =>
  runRule(
    rule,
    await load(
      { [start]: html("x"), [W]: p, "https://example.fi/": p },
      {},
      start,
    ),
    profile,
  );

describe("http/host-variant", () => {
  it("200 duplicate is an error", async () => {
    const f = await run(probe(W, 200));
    expect(f.map((x) => x.severity)).toEqual(["error"]);
  });
  it("redirect is silent", async () => {
    expect(await run(probe(W, 301, S))).toEqual([]);
  });
  it("unreachable variant is info, also in launch", async () => {
    expect((await run({ stop: "network" } as never))[0]?.severity).toBe("info");
    expect(
      (await run({ stop: "network" } as never, "launch"))[0]?.severity,
    ).toBe("info");
  });
  it("200 is an error in launch; works from the www start too", async () => {
    expect((await run(probe(W, 200), "launch"))[0]?.severity).toBe("error");
    const f = await run(probe("https://example.fi/", 200), "dev", W);
    expect(f[0]?.url).toBe("https://example.fi/");
  });
});
