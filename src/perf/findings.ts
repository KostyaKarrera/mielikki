import type { Finding } from "../rules/types.js";
import type { LhrAudit, LhrSubset } from "./lhr.js";
import { perfRuleMetas } from "./rules.js";

const fix = (id: string): string =>
  perfRuleMetas.find((m) => m.id === id)?.fix ?? "";

interface Metric {
  rule: string;
  audit: string;
  good: number;
  poor: number;
  label: string;
  fmt: (v: number) => string;
}

const ms = (v: number): string => `${Math.round(v)} ms`;
const METRICS: Metric[] = [
  {
    rule: "perf/cls",
    audit: "cumulative-layout-shift",
    good: 0.1,
    poor: 0.25,
    label: "Cumulative Layout Shift",
    fmt: (v) => String(Math.round(v * 1000) / 1000),
  },
  {
    rule: "perf/fcp",
    audit: "first-contentful-paint",
    good: 1800,
    poor: 3000,
    label: "First Contentful Paint",
    fmt: ms,
  },
  {
    rule: "perf/lcp",
    audit: "largest-contentful-paint",
    good: 2500,
    poor: 4000,
    label: "Largest Contentful Paint",
    fmt: ms,
  },
  {
    rule: "perf/tbt",
    audit: "total-blocking-time",
    good: 200,
    poor: 600,
    label: "Total Blocking Time",
    fmt: ms,
  },
];

/** Findings of one Lighthouse report, in rule-id order. */
export function perfFindings(lhr: LhrSubset, url: string): Finding[] {
  const out: Finding[] = [];
  for (const m of METRICS) {
    const v = lhr.audits[m.audit]?.numericValue;
    if (v === undefined || v <= m.good) continue;
    const poor = v > m.poor;
    out.push({
      ruleId: m.rule,
      severity: poor ? "warning" : "info",
      url,
      message: `${m.label} is ${m.fmt(v)} (${poor ? "poor" : "needs improvement"}; good is ${m.fmt(m.good)} or less)`,
      fix: fix(m.rule),
      details: {
        value: v,
        good: m.good,
        poor: m.poor,
        preset: lhr.configSettings.formFactor,
      },
    });
  }

  const opps = Object.values(lhr.audits)
    .filter(
      (a) =>
        (a.details?.overallSavingsMs ?? 0) >= 300 &&
        a.score !== null &&
        a.score < 0.9,
    )
    .sort(
      (a, b) =>
        (b.details?.overallSavingsMs ?? 0) -
          (a.details?.overallSavingsMs ?? 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .slice(0, 5);
  for (const a of opps) {
    const saved = Math.round(a.details?.overallSavingsMs ?? 0);
    out.push({
      ruleId: "perf/opportunity",
      severity: "info",
      url,
      message: `${a.title}: potential savings ${saved} ms`,
      fix: fix("perf/opportunity"),
      details: { audit: a.id, savingsMs: saved },
    });
  }

  const score = lhr.categories.performance.score;
  if (score !== null)
    out.push({
      ruleId: "perf/score",
      severity: "info",
      url,
      message: `Lighthouse performance score ${Math.round(score * 100)}/100 (${lhr.configSettings.formFactor}; reference only)`,
      fix: fix("perf/score"),
      details: {
        score: Math.round(score * 100),
        preset: lhr.configSettings.formFactor,
      },
    });
  return out;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2
    ? (s[mid] as number)
    : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

/** Median numericValue (and score) per audit; everything else from the first run. */
export function medianLhr(runs: LhrSubset[]): LhrSubset {
  const first = runs[0];
  if (!first) throw new Error("medianLhr needs at least one run");
  const audits: Record<string, LhrAudit> = {};
  for (const [id, a] of Object.entries(first.audits)) {
    const vals = runs.flatMap((r) => {
      const v = r.audits[id]?.numericValue;
      return v === undefined ? [] : [v];
    });
    audits[id] =
      a.numericValue !== undefined && vals.length > 0
        ? { ...a, numericValue: median(vals) }
        : a;
  }
  const scores = runs.flatMap((r) => {
    const s = r.categories.performance.score;
    return s === null ? [] : [s];
  });
  return {
    ...first,
    categories: {
      performance: { score: scores.length ? median(scores) : null },
    },
    audits,
  };
}
