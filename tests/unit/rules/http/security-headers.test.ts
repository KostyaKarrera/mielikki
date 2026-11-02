import { describe, expect, it } from "vitest";
import { rule } from "../../../../src/rules/http/security-headers.js";
import { html, load, page, runRule } from "./_util.js";

const GOOD = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};
const run = async (start: string, headers: Record<string, string>) =>
  runRule(rule, await load({ [start]: html(page(), headers) }, {}, start));
const missing = (f: { details?: Record<string, unknown> }[]) =>
  f[0]?.details?.missing;

describe("http/security-headers", () => {
  it("reports all missing headers in one finding (https, non-local)", async () => {
    const f = await run("https://example.com/", {});
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe("info");
    expect(missing(f)).toEqual([
      "x-content-type-options",
      "referrer-policy",
      "x-frame-options",
      "strict-transport-security",
    ]);
  });
  it("frame-ancestors in CSP replaces x-frame-options", async () => {
    const { "x-frame-options": _, ...rest } = GOOD;
    const f = await run("https://example.com/", {
      ...rest,
      "content-security-policy": "frame-ancestors 'self'",
    });
    expect(missing(f)).toEqual(["strict-transport-security"]);
  });
  it("all present is silent", async () => {
    expect(
      await run("https://example.com/", {
        ...GOOD,
        "strict-transport-security": "max-age=31536000",
      }),
    ).toEqual([]);
  });
  it("does not require HSTS on http", async () => {
    expect(await run("http://example.com/", GOOD)).toEqual([]);
  });
  it("does not require HSTS on a local host", async () => {
    expect(await run("https://127.0.0.1:5/", GOOD)).toEqual([]);
  });
});
