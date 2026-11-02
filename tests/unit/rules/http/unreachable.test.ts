import { describe, expect, it } from "vitest";
import { rule } from "../../../../src/rules/http/unreachable.js";
import { html, load, O, runRule } from "./_util.js";

describe("http/unreachable", () => {
  const script = {
    [`${O}/`]: html(
      '<a href="/slow/">s</a><a href="/down/">d</a><a href="/gone/">g</a><a href="/ok/">o</a>',
    ),
    [`${O}/slow/`]: { stop: "timeout" as const, detail: "exceeded 1 ms" },
    [`${O}/down/`]: html("x", {}),
    [`${O}/ok/`]: html("ok"),
  };
  it("reports a timeout and a 503, not a 404", async () => {
    const s = {
      ...script,
      [`${O}/down/`]: { html: "x", status: 503 },
    };
    const f = await runRule(rule, await load(s));
    expect(f.map((x) => x.url)).toEqual([`${O}/down/`, `${O}/slow/`]);
    expect(f.every((x) => x.severity === "error")).toBe(true);
    expect(f.find((x) => x.url === `${O}/gone/`)).toBeUndefined();
  });
  it("is silent when everything answers", async () => {
    expect(
      await runRule(rule, await load({ ...script, [`${O}/slow/`]: html("s") })),
    ).toEqual([]);
  });
  it("is an error in launch", async () => {
    const s = await load({
      ...script,
      [`${O}/down/`]: { html: "x", status: 500 },
    });
    expect(rule.meta.launchBlocking).toBe(true);
    expect((await runRule(rule, s, "launch"))[0]?.severity).toBe("error");
  });
});
