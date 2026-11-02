import type { RuleMeta } from "../rules/types.js";

/** Metadata of a rule that only the `perf` command runs (never `check`). */
export type PerfRuleMeta = RuleMeta & { scope: "page"; runBy: "perf" };

const WEB_DEV = "https://web.dev/articles/vitals";
const LH = "https://developer.chrome.com/docs/lighthouse/performance/";

const base: Pick<
  PerfRuleMeta,
  "category" | "scope" | "inputs" | "launchBlocking" | "runBy"
> = {
  category: "perf",
  scope: "page",
  inputs: ["url"],
  launchBlocking: false,
  runBy: "perf",
};

export const perfRuleMetas: PerfRuleMeta[] = [
  {
    ...base,
    id: "perf/lcp",
    title: "Largest Contentful Paint is slow",
    severity: "warning",
    fix: "Good is 2500 ms or less, poor is above 4000 ms (info between). Optimise the largest above-the-fold element: compress and preload the hero image, cut render-blocking CSS/JS, improve server response time.",
    source: WEB_DEV,
  },
  {
    ...base,
    id: "perf/cls",
    title: "Cumulative Layout Shift is high",
    severity: "warning",
    fix: "Good is 0.1 or less, poor is above 0.25 (info between). Set width/height on images and embeds, reserve space for late content, avoid inserting content above existing content.",
    source: WEB_DEV,
  },
  {
    ...base,
    id: "perf/tbt",
    title: "Total Blocking Time is high",
    severity: "warning",
    fix: "Good is 200 ms or less, poor is above 600 ms (info between). TBT is a lab proxy for INP (interaction responsiveness); reduce and split long JavaScript tasks, defer third-party scripts.",
    source: WEB_DEV,
  },
  {
    ...base,
    id: "perf/fcp",
    title: "First Contentful Paint is slow",
    severity: "warning",
    fix: "Good is 1800 ms or less, poor is above 3000 ms (info between). Reduce render-blocking resources, inline critical CSS, serve assets compressed from a fast host or CDN.",
    source: WEB_DEV,
  },
  {
    ...base,
    id: "perf/score",
    title: "Lighthouse performance score",
    severity: "info",
    fix: "Reference only (0-100): fix the individual metric findings rather than chasing the score. Lab results vary between runs; use --runs 3 for a median.",
    source: LH,
  },
  {
    ...base,
    id: "perf/opportunity",
    title: "Lighthouse performance opportunity",
    severity: "info",
    fix: "Apply the suggested optimisation. Listed when Lighthouse estimates at least 300 ms of savings; at most 5 per page, largest savings first.",
    source: LH,
  },
  {
    ...base,
    id: "perf/run-failed",
    title: "Lighthouse run failed",
    severity: "warning",
    fix: "Check that the URL is reachable and Chrome is working (try --no-sandbox in containers or CI); the other URLs' results are kept.",
    source: LH,
  },
];
