import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { alphabetFor, questionTemplates } from "../../src/research/alphabet.js";
import { type DiskCache, nullCache } from "../../src/research/cache.js";
import { createHttpJson } from "../../src/research/http.js";
import { runSuggest, type SuggestOptions } from "../../src/research/suggest.js";
import { serveDir, type TestServer } from "../support/server.js";

const fx = (n: string): string =>
  readFileSync(`tests/fixtures/research/${n}`, "utf8");

function answer(q: string): { body: string; type?: string; status?: number } {
  if (q === "sähköasentaja") return { body: fx("suggest-bare.json") };
  if (q === "sähköasentaja a") return { body: fx("suggest-a.json") };
  if (q === "miten sähköasentaja") return { body: fx("suggest-question.json") };
  return { body: JSON.stringify([q, []]) };
}

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const http = createHttpJson({ userAgent: "test", timeoutMs: 5000 });

function memCache(): DiskCache & { size(): number } {
  const m = new Map<string, string>();
  return {
    async get(k) {
      return m.get(k);
    },
    async set(k, v) {
      m.set(k, v);
    },
    size: () => m.size,
  };
}

async function start(
  suggest: (q: string) => { body: string; type?: string; status?: number },
): Promise<TestServer> {
  server = await serveDir("tests/fixtures/research", {
    suggest: (q) => suggest(q),
  });
  return server;
}

const opts = (
  s: TestServer,
  o: Partial<SuggestOptions> = {},
): SuggestOptions => ({
  seeds: ["sähköasentaja"],
  hl: "fi",
  gl: "fi",
  expand: "alphabet",
  delayMs: 400,
  baseUrl: s.url,
  ...o,
});
const noSleep = async (): Promise<void> => {};

describe("runSuggest", () => {
  it("suggest_returns_sorted_deduped_rows", async () => {
    const s = await start(answer);
    const f = await runSuggest(opts(s), http, nullCache, noSleep);
    const queries = f.rows.map((r) => r.query);
    expect(new Set(queries).size).toBe(queries.length);
    expect(queries).toEqual([...queries].sort());
    expect(queries).toContain("sähköasentaja hinta");
    expect(f.rows.find((r) => r.query === "sähköasentaja hinta")).toEqual({
      seed: "sähköasentaja",
      expansion: "",
      query: "sähköasentaja hinta",
      rank: 2,
    });
    expect(
      f.rows.find((r) => r.query === "sähköasentaja avaimet käteen")?.expansion,
    ).toBe("a");
    expect(s.suggestLog).toContain(
      "/complete/search?client=firefox&hl=fi&gl=fi&q=s%C3%A4hk%C3%B6asentaja%20a",
    );
  });

  it("suggest_expands_alphabet_fi_with_aao", async () => {
    const s = await start(answer);
    await runSuggest(opts(s), http, nullCache, noSleep);
    const qs = s.suggestLog.map((u) =>
      new URL(u, "http://x").searchParams.get("q"),
    );
    expect(qs).toHaveLength(alphabetFor("fi").length + 1);
    expect(qs).toHaveLength(30);
    for (const ch of ["å", "ä", "ö"])
      expect(qs).toContain(`sähköasentaja ${ch}`);
    expect(s.suggestLog.some((u) => u.includes("%C3%A5"))).toBe(true);
  });

  it("suggest_questions_expansion", async () => {
    const s = await start(answer);
    const f = await runSuggest(
      opts(s, { expand: "questions", lang: "fi" }),
      http,
      nullCache,
      noSleep,
    );
    const qs = s.suggestLog.map((u) =>
      new URL(u, "http://x").searchParams.get("q"),
    );
    expect(qs).toHaveLength(questionTemplates("fi").length + 1);
    expect(qs).toContain("miten sähköasentaja");
    expect(qs).not.toContain("sähköasentaja a");
    expect(f.rows.some((r) => r.expansion === "miten")).toBe(true);
  });

  it("suggest_respects_delay", async () => {
    const s = await start(answer);
    const calls: number[] = [];
    const cache = memCache();
    await runSuggest(
      opts(s, { expand: "questions", lang: "fi" }),
      http,
      cache,
      async (ms) => {
        calls.push(ms);
      },
    );
    const n = questionTemplates("fi").length + 1;
    expect(calls).toHaveLength(n - 1);
    expect(calls.every((ms) => ms === 400)).toBe(true);
    calls.length = 0;
    await runSuggest(
      opts(s, { expand: "questions", lang: "fi" }),
      http,
      cache,
      async (ms) => {
        calls.push(ms);
      },
    );
    expect(calls).toHaveLength(0);
  });

  it("suggest_uses_cache_on_second_run", async () => {
    const s = await start(answer);
    const cache = memCache();
    const o = opts(s, { expand: "questions", lang: "fi" });
    const first = await runSuggest(o, http, cache, noSleep);
    const n = s.suggestLog.length;
    expect(n).toBe(questionTemplates("fi").length + 1);
    const second = await runSuggest(o, http, cache, noSleep);
    expect(s.suggestLog.length).toBe(n);
    expect(second.rows).toEqual(first.rows);
    await runSuggest({ ...o, refresh: true }, http, cache, noSleep);
    expect(s.suggestLog.length).toBe(2 * n);
  });

  it("suggest_partial_failure_keeps_results", async () => {
    const s = await start((q) =>
      q === "sähköasentaja ä" ? { status: 429, body: "slow down" } : answer(q),
    );
    const f = await runSuggest(opts(s), http, nullCache, noSleep);
    expect(f.rows.length).toBeGreaterThan(0);
    expect(f.errors).toHaveLength(1);
    expect(f.errors[0]).toMatchObject({
      source: "google-suggest",
      target: "sähköasentaja ä",
    });
    expect(f.errors[0]?.message).toContain("429");
  });

  it("suggest_garbage_response", async () => {
    for (const body of [
      fx("suggest-garbage.txt"),
      "[]",
      fx("suggest-wrongshape.json"),
      '["x",[1,2]]',
    ]) {
      const s = await start(() => ({ body, type: "text/html" }));
      const f = await runSuggest(
        opts(s, { expand: "none" }),
        http,
        nullCache,
        noSleep,
      );
      expect(f.rows).toEqual([]);
      expect(f.errors).toHaveLength(1);
      expect(f.errors[0]?.source).toBe("google-suggest");
      await s.close();
      server = undefined;
    }
  });

  it("garbage is not cached", async () => {
    const s = await start(() => ({ body: "<html>" }));
    const cache = memCache();
    await runSuggest(opts(s, { expand: "none" }), http, cache, noSleep);
    expect(cache.size()).toBe(0);
  });

  it("network failure is a per-request error", async () => {
    const s = await start(answer);
    const base = s.url;
    await s.close();
    server = undefined;
    const f = await runSuggest(
      { ...opts(s, { expand: "none" }), baseUrl: base },
      http,
      nullCache,
      noSleep,
    );
    expect(f.errors).toHaveLength(1);
    expect(f.errors[0]?.message).toContain("network");
  });

  it("alphabet follows the effective hl, not another language", async () => {
    const s = await start(answer);
    await runSuggest(opts(s, { hl: "en", gl: "fi" }), http, nullCache, noSleep);
    const qs = s.suggestLog.map((u) =>
      new URL(u, "http://x").searchParams.get("q"),
    );
    expect(qs).toHaveLength(27);
    expect(qs).not.toContain("sähköasentaja ä");
  });

  it("cache get/set failures are ignored, rows kept", async () => {
    const s = await start(answer);
    const broken: DiskCache = {
      async get() {
        throw new Error("EACCES");
      },
      async set() {
        throw new Error("ENOSPC");
      },
    };
    const f = await runSuggest(
      opts(s, { expand: "none" }),
      http,
      broken,
      noSleep,
    );
    expect(f.errors).toEqual([]);
    expect(f.rows).toHaveLength(3);
    expect(f.succeeded).toBe(1);
  });

  it("corrupt cache entry is a miss", async () => {
    const s = await start(answer);
    const cache: DiskCache = {
      async get() {
        return "<<not json>>";
      },
      async set() {},
    };
    const f = await runSuggest(
      opts(s, { expand: "none" }),
      http,
      cache,
      noSleep,
    );
    expect(s.suggestLog).toHaveLength(1);
    expect(f.rows).toHaveLength(3);
    expect(f.errors).toEqual([]);
  });

  it("delay 0 never sleeps", async () => {
    const s = await start(answer);
    let calls = 0;
    await runSuggest(
      opts(s, { delayMs: 0, expand: "questions", lang: "fi" }),
      http,
      nullCache,
      async () => {
        calls++;
      },
    );
    expect(calls).toBe(0);
  });

  it("stops after 5 consecutive 429/503 with one summary error", async () => {
    const s = await start(() => ({ status: 429, body: "no" }));
    const f = await runSuggest(opts(s), http, nullCache, noSleep);
    expect(s.suggestLog).toHaveLength(5);
    expect(f.errors).toHaveLength(6);
    expect(f.errors.find((e) => e.target === "(remaining)")?.message).toBe(
      "skipped 25 requests after repeated 429/503",
    );
    expect(f.succeeded).toBe(0);
  });

  it("a success resets the throttle counter", async () => {
    let n = 0;
    const s = await start((q) =>
      ++n % 2 === 0 ? answer(q) : { status: 503, body: "no" },
    );
    const f = await runSuggest(opts(s), http, nullCache, noSleep);
    expect(s.suggestLog).toHaveLength(30);
    expect(f.errors.every((e) => e.message === "HTTP 503")).toBe(true);
  });

  it("NFC-normalizes and dedupes seeds", async () => {
    const s = await start(answer);
    const f = await runSuggest(
      opts(s, {
        seeds: ["  sa\u0308hko\u0308asentaja ", "sähköasentaja"],
        expand: "none",
      }),
      http,
      nullCache,
      noSleep,
    );
    expect(s.suggestLog).toHaveLength(1);
    expect(s.suggestLog[0]).toContain("q=s%C3%A4hk%C3%B6asentaja");
    expect(f.rows[0]?.seed).toBe("sähköasentaja");
  });

  it("caps error message length at 200", async () => {
    const long: typeof http = {
      getText: async () => {
        throw new Error(`network: ${"x".repeat(500)}`);
      },
      postJson: async () => ({ status: 200, text: "" }),
    };
    const f = await runSuggest(
      { seeds: ["a"], hl: "fi", gl: "fi", expand: "none", delayMs: 0 },
      long,
      nullCache,
      noSleep,
    );
    expect(f.errors[0]?.message).toHaveLength(200);
  });
});
