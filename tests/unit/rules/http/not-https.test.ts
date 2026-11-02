import { describe, expect, it } from "vitest";
import { rule } from "../../../../src/rules/http/not-https.js";
import { html, load, runRule } from "./_util.js";

describe("http/not-https", () => {
  it("fires when the start ends on http: on a public host; error in launch too", async () => {
    const s = await load(
      { "http://example.fi/": html("x") },
      {},
      "http://example.fi/",
    );
    expect(await runRule(rule, s)).toHaveLength(1);
    expect((await runRule(rule, s, "launch"))[0]?.severity).toBe("error");
  });
  it("fires when https redirects down to http", async () => {
    const s = await load(
      {
        "https://example.fi/": {
          hops: [
            {
              url: "https://example.fi/",
              status: 301,
              location: "http://example.fi/",
            },
          ],
          final: {
            url: "http://example.fi/",
            status: 200,
            headers: { "content-type": "text/html" },
            bytes: 1,
            body: "<h1>x</h1>",
          },
        },
      },
      {},
      "https://example.fi/",
    );
    expect(await runRule(rule, s)).toHaveLength(1);
  });
  it("is silent on https and on localhost http", async () => {
    const a = await load(
      { "https://example.fi/": html("x") },
      {},
      "https://example.fi/",
    );
    expect(await runRule(rule, a)).toEqual([]);
    const b = await load(
      { "http://localhost:4321/": html("x") },
      {},
      "http://localhost:4321/",
    );
    expect(await runRule(rule, b)).toEqual([]);
  });
});
