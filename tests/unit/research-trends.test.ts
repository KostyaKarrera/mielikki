import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { runResearchTrends } from "../../src/commands/research.js";
import { type DiskCache, nullCache } from "../../src/research/cache.js";
import { createHttpJson } from "../../src/research/http.js";
import {
  ResearchSourceError,
  runTrends,
  summarize,
} from "../../src/research/trends.js";
import {
  type Behaviors,
  serveDir,
  type TestServer,
} from "../support/server.js";

const fx = (n: string): string =>
  readFileSync(`tests/fixtures/research/${n}`, "utf8");
const http = createHttpJson({ userAgent: "test", timeoutMs: 5000 });

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const okTrends = (path: string) =>
  path.endsWith("/explore")
    ? {
        body: fx("trends-explore.txt"),
        headers: {
          "set-cookie": ["NID=abc123; Path=/; HttpOnly", "B=1; Path=/"],
        },
      }
    : { body: fx("trends-multiline.txt") };

const opts = (baseUrl: string, terms = ["sähköasentaja", "led"]) => ({
  terms,
  geo: "FI",
  hl: "fi",
  timeframe: "today 5-y",
  baseUrl,
});

describe("trends", () => {
  it("trends_parses_prefixed_json", async () => {
    server = await serveDir("tests/fixtures/research", { trends: okTrends });
    const r = await runTrends(opts(server.url), http, nullCache);
    expect(r.rows).toEqual([
      { term: "led", weekStart: "2024-01-01", value: 10 },
      { term: "led", weekStart: "2024-01-08", value: 20 },
      { term: "led", weekStart: "2024-06-30", value: 30 },
      { term: "sähköasentaja", weekStart: "2024-01-01", value: 80 },
      { term: "sähköasentaja", weekStart: "2024-01-08", value: 100 },
      { term: "sähköasentaja", weekStart: "2024-06-30", value: 20 },
    ]);
    // cookies carried from explore to widgetdata, name=value only
    expect(server.trendsCookies[0]).toBe("");
    expect(server.trendsCookies[1]).toBe("NID=abc123; B=1");
    expect(server.trendsLog[1]).toContain("token=TOK123");
  });

  it("trends_summary_seasonality", () => {
    const rows = [
      { term: "a", weekStart: "2024-01-08", value: 100 },
      { term: "a", weekStart: "2024-01-14", value: 60 },
      { term: "a", weekStart: "2024-07-07", value: 40 },
      { term: "z", weekStart: "2024-03-03", value: 0 },
    ];
    const [a, z] = summarize(rows);
    expect(a?.peakMonth).toBe(1);
    expect(a?.seasonality).toHaveLength(12);
    expect(Math.max(...(a?.seasonality ?? []))).toBe(100);
    expect(a?.seasonality[6]).toBe(50);
    expect(a?.average).toBe(66.67);
    expect(z?.peakMonth).toBeNull();
    expect(z?.seasonality.every((v) => v === 0)).toBe(true);
  });

  type Reply = ReturnType<NonNullable<Behaviors["trends"]>>;
  const blocked: [string, () => Reply][] = [
    ["429", () => ({ status: 429, body: "Too Many Requests" })],
    [
      "302 to consent",
      () => ({
        status: 302,
        headers: { location: "https://consent.google.com/ml?continue=x" },
        body: "",
      }),
    ],
    [
      "html",
      () => ({ type: "text/html", body: "<html>captcha secret-body</html>" }),
    ],
    ["no prefix", () => ({ body: '{"widgets":[]}' })],
    ["wrong shape", () => ({ body: ')]}\'\n{"widgets":5}' })],
    [
      "no timeline widget",
      () => ({ body: ')]}\'\n{"widgets":[{"id":"GEO_MAP","token":"t"}]}' }),
    ],
  ];
  it.each(blocked)("trends_blocked_is_clean_error: %s", async (_n, h) => {
    server = await serveDir("tests/fixtures/research", { trends: () => h() });
    const err = await runTrends(opts(server.url), http, nullCache).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ResearchSourceError);
    expect((err as Error).message).toMatch(
      /^Google Trends unavailable \(unofficial source\): /,
    );
    expect((err as Error).message).not.toContain("secret-body");
    expect((err as Error).message.length).toBeLessThanOrEqual(200);

    let out = "";
    let warn = "";
    const code = await runResearchTrends(
      ["led"],
      {
        timeframe: "today 5-y",
        format: "json",
        noMeta: true,
        refresh: false,
        noCache: true,
        geo: "FI",
        hl: "fi",
      },
      {
        cwd: process.cwd(),
        write: (s) => (out += s),
        warn: (s) => (warn += s),
      },
      { baseUrl: server.url },
    );
    expect(code).toBe(1);
    expect(out).toBe("");
    expect(warn).toMatch(/^Google Trends unavailable \(unofficial source\):/);
    expect(warn).not.toMatch(/\n\s+at /);
  });

  it("rejects mismatched multiline shape", async () => {
    server = await serveDir("tests/fixtures/research", {
      trends: (p) =>
        p.endsWith("/explore")
          ? { body: fx("trends-explore.txt") }
          : { body: fx("trends-multiline-bad.txt") },
    });
    await expect(runTrends(opts(server.url), http, nullCache)).rejects.toThrow(
      ResearchSourceError,
    );
    // value count must match the number of terms
    await expect(
      runTrends(opts(server.url, ["a"]), http, nullCache),
    ).rejects.toThrow(ResearchSourceError);
  });

  it("trends_groups_of_five_share_anchor", async () => {
    server = await (async () => {
      return serveDir("tests/fixtures/research", {
        trends: (p, params) => {
          if (p.endsWith("/explore")) {
            const req = JSON.parse(params.get("req") ?? "{}") as {
              comparisonItem: { keyword: string }[];
            };
            const n = req.comparisonItem.length;
            return {
              body: `)]}'\n${JSON.stringify({
                widgets: [{ id: "TIMESERIES", token: `t${n}`, request: { n } }],
              })}`,
            };
          }
          const n = (JSON.parse(params.get("req") ?? "{}") as { n: number }).n;
          return {
            body: `)]}'\n${JSON.stringify({
              default: {
                timelineData: [
                  {
                    time: "1704067200",
                    value: Array.from({ length: n }, (_, i) => i + 1),
                  },
                ],
              },
            })}`,
          };
        },
      });
    })();
    const terms = ["t1", "t2", "t3", "t4", "t5", "t6", "t7"];
    const r = await runTrends(opts(server.url, terms), http, nullCache);
    const groups = server.trendsLog
      .filter((u) => u.startsWith("/trends/api/explore"))
      .map((u) =>
        (
          JSON.parse(
            new URL(u, "http://x").searchParams.get("req") ?? "{}",
          ) as {
            comparisonItem: { keyword: string }[];
          }
        ).comparisonItem.map((c) => c.keyword),
      );
    expect(groups).toEqual([
      ["t1", "t2", "t3", "t4", "t5"],
      ["t1", "t6", "t7"],
    ]);
    expect(r.rows.map((x) => x.term)).toEqual(terms);
  });

  it("trends_cache", async () => {
    server = await serveDir("tests/fixtures/research", { trends: okTrends });
    const m = new Map<string, string>();
    const cache: DiskCache = {
      get: async (k) => m.get(k),
      set: async (k, v) => void m.set(k, v),
    };
    const a = await runTrends(opts(server.url), http, cache);
    const n = server.trendsLog.length;
    expect(n).toBe(2);
    const b = await runTrends(opts(server.url), http, cache);
    expect(server.trendsLog.length).toBe(n);
    expect(b.rows).toEqual(a.rows);
  });

  it("cache failures are misses, not fatal", async () => {
    server = await serveDir("tests/fixtures/research", { trends: okTrends });
    const bad: DiskCache = {
      get: async () => {
        throw new Error("boom");
      },
      set: async () => {
        throw new Error("boom");
      },
    };
    const r = await runTrends(opts(server.url), http, bad);
    expect(r.rows).toHaveLength(6);
  });
});
