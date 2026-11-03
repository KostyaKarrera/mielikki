import { z } from "zod";
import type { DiskCache } from "./cache.js";
import type { HttpJson } from "./http.js";
import type { DataFile } from "./types.js";

export interface TrendsRow {
  term: string;
  /** ISO date (UTC) of the first day of the point. */
  weekStart: string;
  /** Relative interest 0-100. */
  value: number;
}

export interface TrendsSummary {
  term: string;
  average: number;
  /** 1-12, or null when all data is zero. */
  peakMonth: number | null;
  /** 12 monthly averages normalised so the maximum is 100. */
  seasonality: number[];
}

export interface TrendsOptions {
  terms: string[];
  geo: string;
  hl: string;
  timeframe: string;
  /** Test override of https://trends.google.com. */
  baseUrl?: string;
}

export type TrendsResult = DataFile<TrendsRow> & { summary: TrendsSummary[] };

export class ResearchSourceError extends Error {
  constructor(detail: string) {
    super(`Google Trends unavailable (unofficial source): ${detail}`);
    this.name = "ResearchSourceError";
  }
}

const DEFAULT_BASE = "https://trends.google.com";
const PREFIX = ")]}'";
const GROUP = 5;

const Explore = z.object({
  widgets: z.array(
    z.object({ id: z.string(), token: z.string().optional() }).passthrough(),
  ),
});
const Multiline = z.object({
  default: z.object({
    timelineData: z.array(
      z.object({
        time: z.string().regex(/^\d{1,12}$/),
        value: z.array(z.number()),
      }),
    ),
  }),
});

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function stripPrefix(text: string): unknown {
  if (!text.startsWith(PREFIX))
    throw new ResearchSourceError("unexpected response format");
  try {
    return JSON.parse(text.slice(PREFIX.length));
  } catch {
    throw new ResearchSourceError("response is not JSON");
  }
}

function cookiePairs(headers: Record<string, string>): string {
  const raw = headers["set-cookie"];
  if (!raw) return "";
  const pairs: string[] = [];
  for (const line of raw.split("\n")) {
    const m = /^\s*([^=;\s]+)=([^;]*)/.exec(line);
    if (m) pairs.push(`${m[1]}=${m[2]}`);
  }
  return pairs.join("; ");
}

async function get(
  http: HttpJson,
  url: string,
  headers: Record<string, string> = {},
): Promise<{ headers: Record<string, string>; text: string }> {
  let res: Awaited<ReturnType<HttpJson["getText"]>>;
  try {
    res = await http.getText(url, { headers });
  } catch (e) {
    const m = e instanceof Error ? (e.message.split("\n")[0] ?? "") : "";
    throw new ResearchSourceError(m.slice(0, 120) || "request failed");
  }
  if (res.status !== 200) throw new ResearchSourceError(`HTTP ${res.status}`);
  return res;
}

async function fetchTimeline(
  group: string[],
  o: TrendsOptions,
  http: HttpJson,
  cache: DiskCache,
  base: string,
): Promise<z.infer<typeof Multiline>["default"]["timelineData"]> {
  const key = `trends|${o.geo}|${o.hl}|${o.timeframe}|${JSON.stringify(group)}`;
  let hit: string | undefined;
  try {
    hit = await cache.get(key);
  } catch {
    hit = undefined;
  }
  if (hit !== undefined) {
    try {
      const r = Multiline.safeParse(JSON.parse(hit));
      if (
        r.success &&
        r.data.default.timelineData.every(
          (p) => p.value.length === group.length,
        )
      ) {
        return r.data.default.timelineData;
      }
    } catch {
      // corrupt cache entry = miss
    }
  }

  const req = JSON.stringify({
    comparisonItem: group.map((keyword) => ({
      keyword,
      geo: o.geo,
      time: o.timeframe,
    })),
    category: 0,
    property: "",
  });
  const hl = encodeURIComponent(o.hl);
  const explore = await get(
    http,
    `${base}/trends/api/explore?hl=${hl}&tz=0&req=${encodeURIComponent(req)}`,
  );
  const ex = Explore.safeParse(stripPrefix(explore.text));
  if (!ex.success) throw new ResearchSourceError("unexpected response format");
  const widget = ex.data.widgets.find((w) => w.id === "TIMESERIES");
  if (!widget?.token || widget.request === undefined) {
    throw new ResearchSourceError("timeline widget not found");
  }
  const cookie = cookiePairs(explore.headers);
  const data = await get(
    http,
    `${base}/trends/api/widgetdata/multiline?hl=${hl}&tz=0&req=${encodeURIComponent(JSON.stringify(widget.request))}&token=${encodeURIComponent(widget.token)}`,
    cookie ? { cookie } : {},
  );
  const ml = Multiline.safeParse(stripPrefix(data.text));
  if (
    !ml.success ||
    ml.data.default.timelineData.length === 0 ||
    ml.data.default.timelineData.some((p) => p.value.length !== group.length)
  ) {
    throw new ResearchSourceError("unexpected response format");
  }
  try {
    await cache.set(key, JSON.stringify(ml.data));
  } catch {
    // best-effort
  }
  return ml.data.default.timelineData;
}

export function summarize(rows: TrendsRow[]): TrendsSummary[] {
  const byTerm = new Map<string, TrendsRow[]>();
  for (const r of rows) byTerm.set(r.term, [...(byTerm.get(r.term) ?? []), r]);
  return [...byTerm.entries()]
    .sort(([a], [b]) => cmp(a, b))
    .map(([term, rs]) => {
      const sums = new Array<number>(12).fill(0);
      const counts = new Array<number>(12).fill(0);
      let total = 0;
      for (const r of rs) {
        const m = Number(r.weekStart.slice(5, 7)) - 1;
        sums[m] = (sums[m] as number) + r.value;
        counts[m] = (counts[m] as number) + 1;
        total += r.value;
      }
      const avgs = sums.map((s, i) =>
        (counts[i] as number) > 0 ? s / (counts[i] as number) : 0,
      );
      const max = Math.max(...avgs);
      const seasonality = avgs.map((a) =>
        max > 0 ? Math.round((a / max) * 1000) / 10 : 0,
      );
      return {
        term,
        average: rs.length ? Math.round((total / rs.length) * 100) / 100 : 0,
        peakMonth: max > 0 ? avgs.indexOf(max) + 1 : null,
        seasonality,
      };
    });
}

export async function runTrends(
  o: TrendsOptions,
  http: HttpJson,
  cache: DiskCache,
): Promise<TrendsResult> {
  const terms = [
    ...new Set(o.terms.map((t) => t.normalize("NFC").trim()).filter(Boolean)),
  ];
  const base = (o.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
  const groups: string[][] = [];
  if (terms.length <= GROUP) {
    if (terms.length) groups.push(terms);
  } else {
    const [anchor, ...rest] = terms as [string, ...string[]];
    for (let i = 0; i < rest.length; i += GROUP - 1) {
      groups.push([anchor, ...rest.slice(i, i + GROUP - 1)]);
    }
  }

  const seen = new Set<string>();
  const rows: TrendsRow[] = [];
  for (const group of groups) {
    const timeline = await fetchTimeline(group, o, http, cache, base);
    for (const point of timeline) {
      const weekStart = new Date(Number(point.time) * 1000)
        .toISOString()
        .slice(0, 10);
      group.forEach((term, i) => {
        const id = `${term}\u0000${weekStart}`;
        if (seen.has(id)) return; // shared anchor: first group wins
        seen.add(id);
        rows.push({ term, weekStart, value: point.value[i] as number });
      });
    }
  }
  rows.sort((a, b) => cmp(a.term, b.term) || cmp(a.weekStart, b.weekStart));
  return { kind: "trends", rows, errors: [], summary: summarize(rows) };
}
