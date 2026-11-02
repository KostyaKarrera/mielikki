import { describe, expect, it } from "vitest";
import { rule } from "../../../../src/rules/http/robots-status.js";
import { html, load, O, runRule } from "./_util.js";

const run = async (
  robots: Parameters<typeof load>[0][string] | undefined,
  profile: "dev" | "launch" = "dev",
) =>
  runRule(
    rule,
    await load({
      [`${O}/`]: html("x"),
      ...(robots ? { [`${O}/robots.txt`]: robots } : {}),
    }),
    profile,
  );
const status = (n: number) => ({ html: "", status: n });

describe("http/robots-status", () => {
  it("5xx and timeout are errors", async () => {
    expect((await run(status(503)))[0]?.severity).toBe("error");
    expect((await run({ stop: "timeout" }))[0]?.severity).toBe("error");
  });
  it("401/403 are warnings, error in launch", async () => {
    expect((await run(status(403)))[0]?.severity).toBe("warning");
    expect((await run(status(401), "launch"))[0]?.severity).toBe("error");
  });
  it("200 and 404 are silent", async () => {
    expect(
      await run({
        html: "User-agent: *\nAllow: /",
        headers: { "content-type": "text/plain" },
      }),
    ).toEqual([]);
    expect(await run(undefined)).toEqual([]);
  });
});
