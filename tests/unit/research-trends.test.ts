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
const noSleep = async (): Promise<void> => {};

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const okTrends = (path: string) =>
  path === "/trends/"
    ? {
        body: "<html></html>",
        headers: { "set-cookie": ["NID=boot1; Path=/", "B=1; Path=/"] },
      }
    : path.endsWith("/explore")
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
  sleep: noSleep,
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
    // cookies from the bootstrap go to explore and widgetdata, name=value only
    expect(server.trendsLog[0]).toBe("/trends/?geo=FI");
    expect(server.trendsCookies).toEqual([
      "",
      "NID=boot1; B=1",
      "NID=boot1; B=1",
    ]);
    expect(server.trendsLog[2]).toContain("token=TOK123");
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
      { baseUrl: server.url, sleep: noSleep },
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
    expect(n).toBe(3);
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

  const dyn = (
    series: (n: number, group: number) => number[][],
    prefix = ")]}'\n",
    times = ["1704067200", "1704672000"],
  ): Behaviors["trends"] => {
    let g = 0;
    return (p, params) => {
      if (p.endsWith("/explore")) {
        const n = (
          JSON.parse(params.get("req") ?? "{}") as { comparisonItem: unknown[] }
        ).comparisonItem.length;
        g++;
        return {
          body: `${prefix}${JSON.stringify({ widgets: [{ id: "TIMESERIES", token: "t", request: { n, g } }] })}`,
        };
      }
      const r = JSON.parse(params.get("req") ?? "{}") as {
        n: number;
        g: number;
      };
      const vals = series(r.n, r.g);
      return {
        body: `${prefix}${JSON.stringify({
          default: {
            timelineData: times.map((time, i) => ({ time, value: vals[i] })),
          },
        })}`,
      };
    };
  };

  it("rescales later groups to the anchor", async () => {
    // group1 anchor sums 10+20=30; group2 anchor sums 60+60=120 -> factor 0.25
    server = await serveDir("tests/fixtures/research", {
      trends: dyn((n, g) =>
        g === 1
          ? [
              Array.from({ length: n }, () => 10),
              Array.from({ length: n }, () => 20),
            ]
          : [
              [60, 100, 50],
              [60, 80, 33],
            ],
      ),
    });
    const r = await runTrends(
      opts(server.url, ["a", "b", "c", "d", "e", "f", "g"]),
      http,
      nullCache,
    );
    const v = (t: string, w: string) =>
      r.rows.find((x) => x.term === t && x.weekStart === w)?.value;
    expect(v("a", "2024-01-01")).toBe(10);
    expect(v("f", "2024-01-01")).toBe(25);
    expect(v("g", "2024-01-08")).toBe(8.3);
    expect(v("b", "2024-01-01")).toBe(10);
    expect(r.errors).toEqual([]);
  });

  it("zero anchor keeps raw values and records an error", async () => {
    server = await serveDir("tests/fixtures/research", {
      trends: dyn((n, g) =>
        g === 1
          ? [
              Array.from({ length: n }, () => 10),
              Array.from({ length: n }, () => 20),
            ]
          : [
              [0, 40, 50],
              [0, 80, 33],
            ],
      ),
    });
    const r = await runTrends(
      opts(server.url, ["a", "b", "c", "d", "e", "f", "g"]),
      http,
      nullCache,
    );
    expect(r.rows.find((x) => x.term === "f")?.value).toBe(40);
    expect(r.errors).toEqual([
      {
        source: "google-trends",
        target: "group 2",
        message: "group 2 not comparable: anchor has no interest",
      },
    ]);
  });

  it.each([")]}'\n", ")]}',\n"])("accepts prefix %j", async (prefix) => {
    server = await serveDir("tests/fixtures/research", {
      trends: dyn((n) => [Array(n).fill(1), Array(n).fill(2)], prefix),
    });
    const r = await runTrends(opts(server.url, ["a"]), http, nullCache);
    expect(r.rows).toHaveLength(2);
  });

  it("keeps all intraday points with full timestamps", async () => {
    const times = ["1704067200", "1704070800", "1704074400"];
    server = await serveDir("tests/fixtures/research", {
      trends: dyn(
        (n) => [[1], [2], [3]].map((v) => Array(n).fill(v[0])),
        ")]}'\n",
        times,
      ),
    });
    const r = await runTrends(
      { ...opts(server.url, ["a"]), timeframe: "now 7-d" },
      http,
      nullCache,
    );
    expect(r.rows.map((x) => x.weekStart)).toEqual([
      "2024-01-01T00:00:00Z",
      "2024-01-01T01:00:00Z",
      "2024-01-01T02:00:00Z",
    ]);
  });

  it("summary buckets weeks by midpoint", () => {
    const [a] = summarize([
      { term: "a", weekStart: "2024-01-29", value: 100 },
      { term: "a", weekStart: "2024-02-05", value: 10 },
    ]);
    expect(a?.peakMonth).toBe(2);
  });

  it("redirect on the cookie-bearing call is unavailable", async () => {
    server = await serveDir("tests/fixtures/research", {
      trends: (p) =>
        p === "/trends/" || p.endsWith("/explore")
          ? okTrends(p)
          : {
              status: 302,
              headers: { location: "https://consent.google.com/x" },
              body: "",
            },
    });
    await expect(runTrends(opts(server.url), http, nullCache)).rejects.toThrow(
      /^Google Trends unavailable \(unofficial source\): network: redirect to another host/,
    );
    expect(server.trendsLog).toHaveLength(3);
  });

  it("trends_parses_real_recorded_responses", async () => {
    server = await serveDir("tests/fixtures/research", {
      trends: (p) =>
        p === "/trends/"
          ? { body: "", headers: { "set-cookie": "NID=real; Path=/" } }
          : p.endsWith("/explore")
            ? { body: fx("trends-explore-real.txt") }
            : { body: fx("trends-multiline-real.txt") },
    });
    const r = await runTrends(
      opts(server.url, ["sähköasentaja"]),
      http,
      nullCache,
    );
    expect(r.rows.length).toBeGreaterThan(200);
    expect(r.rows[0]).toEqual({
      term: "sähköasentaja",
      weekStart: "2021-10-31",
      value: 40,
    });
    expect(r.summary[0]?.seasonality).toHaveLength(12);
  });

  it("trends_bootstrap_cookie_required", async () => {
    server = await serveDir("tests/fixtures/research", {
      trends: (p, _q, h) => {
        if (p === "/trends/") return okTrends(p);
        if (!/(^|; )NID=boot1/.test(h.cookie ?? "")) {
          return { status: 429, type: "text/html", body: "Too Many Requests" };
        }
        return okTrends(p);
      },
    });
    const r = await runTrends(opts(server.url), http, nullCache);
    expect(r.rows).toHaveLength(6);
    // no cookie from the bootstrap -> 429 -> clean error
    await server.close();
    server = await serveDir("tests/fixtures/research", {
      trends: (p) =>
        p === "/trends/"
          ? { body: "" }
          : { status: 429, type: "text/html", body: "x" },
    });
    await expect(runTrends(opts(server.url), http, nullCache)).rejects.toThrow(
      /HTTP 429/,
    );
  });

  it("trends_pauses_between_requests_not_before_first", async () => {
    server = await serveDir("tests/fixtures/research", { trends: okTrends });
    const events: string[] = [];
    const sleep = async (ms: number): Promise<void> => {
      events.push(`sleep ${ms} after ${server?.trendsLog.length}`);
    };
    await runTrends({ ...opts(server.url), sleep }, http, nullCache);
    // bootstrap, pause, explore, pause, widgetdata
    expect(events).toEqual(["sleep 1000 after 1", "sleep 1000 after 2"]);
  });

  it("trends_later_group_failure_keeps_earlier_groups", async () => {
    let g = 0;
    server = await serveDir("tests/fixtures/research", {
      trends: (p, params) => {
        if (p === "/trends/") return okTrends(p);
        if (p.endsWith("/explore")) {
          g++;
          if (g === 2) return { status: 429, type: "text/html", body: "no" };
          const n = (
            JSON.parse(params.get("req") ?? "{}") as {
              comparisonItem: unknown[];
            }
          ).comparisonItem.length;
          return {
            body: `)]}'\n${JSON.stringify({ widgets: [{ id: "TIMESERIES", token: "t", request: { n } }] })}`,
          };
        }
        const n = (JSON.parse(params.get("req") ?? "{}") as { n: number }).n;
        return {
          body: `)]}'\n${JSON.stringify({ default: { timelineData: [{ time: "1704067200", value: Array(n).fill(7) }] } })}`,
        };
      },
    });
    const terms = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    const r = await runTrends(opts(server.url, terms), http, nullCache);
    expect(r.rows.map((x) => x.term)).toEqual(["a", "b", "c", "d", "e"]);
    expect(r.errors).toEqual([
      {
        source: "google-trends",
        target: "a, f, g, h, i",
        message: "Google Trends unavailable (unofficial source): HTTP 429",
      },
    ]);
  });
});
