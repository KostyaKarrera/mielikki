import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { medianLhr, perfFindings } from "../../src/perf/findings.js";
import type { LhrAudit, LhrSubset } from "../../src/perf/lhr.js";

const load = (n: string): LhrSubset =>
  JSON.parse(readFileSync(`tests/fixtures/lhr/${n}.json`, "utf8")) as LhrSubset;
const URL_ = "https://example.test/";

function withMetric(id: string, value: number): LhrSubset {
  const l = load("good");
  l.audits[id] = { ...(l.audits[id] as LhrAudit), numericValue: value };
  return l;
}
const sev = (l: LhrSubset, rule: string): string | undefined =>
  perfFindings(l, URL_).find((f) => f.ruleId === rule)?.severity;

describe("perfFindings", () => {
  it("good report has no warning or error", () => {
    const f = perfFindings(load("good"), URL_);
    expect(f.filter((x) => x.severity !== "info")).toEqual([]);
    expect(f.map((x) => x.ruleId)).toEqual(["perf/score"]);
  });

  it("poor report gives four warnings in rule order", () => {
    const w = perfFindings(load("poor"), URL_).filter(
      (x) => x.severity === "warning",
    );
    expect(w.map((x) => x.ruleId)).toEqual([
      "perf/cls",
      "perf/fcp",
      "perf/lcp",
      "perf/tbt",
    ]);
    expect(w.every((x) => x.url === URL_)).toBe(true);
  });

  it("LCP boundaries", () => {
    const lcp = (v: number) =>
      sev(withMetric("largest-contentful-paint", v), "perf/lcp");
    expect(lcp(2500)).toBeUndefined();
    expect(lcp(2501)).toBe("info");
    expect(lcp(4000)).toBe("info");
    expect(lcp(4001)).toBe("warning");
  });

  it("CLS, TBT and FCP boundaries", () => {
    const c = (id: string, rule: string, v: number) =>
      sev(withMetric(id, v), rule);
    expect(c("cumulative-layout-shift", "perf/cls", 0.1)).toBeUndefined();
    expect(c("cumulative-layout-shift", "perf/cls", 0.11)).toBe("info");
    expect(c("cumulative-layout-shift", "perf/cls", 0.25)).toBe("info");
    expect(c("cumulative-layout-shift", "perf/cls", 0.26)).toBe("warning");
    expect(c("total-blocking-time", "perf/tbt", 200)).toBeUndefined();
    expect(c("total-blocking-time", "perf/tbt", 600)).toBe("info");
    expect(c("total-blocking-time", "perf/tbt", 601)).toBe("warning");
    expect(c("first-contentful-paint", "perf/fcp", 1800)).toBeUndefined();
    expect(c("first-contentful-paint", "perf/fcp", 3000)).toBe("info");
    expect(c("first-contentful-paint", "perf/fcp", 3001)).toBe("warning");
  });

  it("TBT fix says it is an INP proxy", () => {
    const f = perfFindings(load("poor"), URL_).find(
      (x) => x.ruleId === "perf/tbt",
    );
    expect(f?.fix).toMatch(/INP/);
  });

  it("opportunities: savings >= 300 and score < 0.9, sorted, max 5", () => {
    const o = perfFindings(load("poor"), URL_).filter(
      (x) => x.ruleId === "perf/opportunity",
    );
    expect(o.map((x) => x.details?.audit)).toEqual([
      "render-blocking-resources",
      "unused-javascript",
      "uses-optimized-images",
      "unminified-css",
    ]);
    expect(o.every((x) => x.severity === "info")).toBe(true);
  });

  it("opportunities are capped at 5 and ties sort by id", () => {
    const l = load("good");
    for (const id of ["g", "f", "e", "d", "c", "b", "a"])
      l.audits[id] = {
        id,
        title: id,
        score: 0.1,
        details: { type: "opportunity", overallSavingsMs: 500 },
      };
    const o = perfFindings(l, URL_)
      .filter((x) => x.ruleId === "perf/opportunity")
      .map((x) => x.details?.audit);
    expect(o).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("medianLhr", () => {
  it("takes the median numericValue of three runs, rest from the first", () => {
    const mk = (lcp: number, name: string): LhrSubset => {
      const l = withMetric("largest-contentful-paint", lcp);
      l.finalDisplayedUrl = name;
      return l;
    };
    const m = medianLhr([mk(3000, "first"), mk(1000, "b"), mk(2000, "c")]);
    expect(m.audits["largest-contentful-paint"]?.numericValue).toBe(2000);
    expect(m.finalDisplayedUrl).toBe("first");
  });
  it("median of two is the mean", () => {
    const m = medianLhr([
      withMetric("total-blocking-time", 100),
      withMetric("total-blocking-time", 300),
    ]);
    expect(m.audits["total-blocking-time"]?.numericValue).toBe(200);
  });
});
