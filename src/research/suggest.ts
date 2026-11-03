import { z } from "zod";
import { alphabetFor, questionTemplates } from "./alphabet.js";
import type { DiskCache } from "./cache.js";
import type { HttpJson } from "./http.js";
import type { DataFile, ResearchError } from "./types.js";

export interface SuggestRow {
  seed: string;
  /** Letter or question template; "" for the seed itself. */
  expansion: string;
  query: string;
  rank: number;
}

export interface SuggestOptions {
  seeds: string[];
  hl: string;
  gl: string;
  expand: "none" | "alphabet" | "questions" | "both";
  delayMs: number;
  /** Test override of https://suggestqueries.google.com. */
  baseUrl?: string;
  /** Language for the alphabet and question templates (default: hl). */
  lang?: string;
  /** Ignore cached answers (still writes fresh ones). */
  refresh?: boolean;
}

export type SuggestResult = DataFile<SuggestRow> & {
  /** Number of distinct requests attempted (cache hits included). */
  attempted: number;
};

const SOURCE = "google-suggest";
const DEFAULT_BASE = "https://suggestqueries.google.com";
const Answer = z.tuple([z.string(), z.array(z.string())]).rest(z.unknown());

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function parseAnswer(text: string): string[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("response is not JSON");
  }
  const r = Answer.safeParse(json);
  if (!r.success) throw new Error("unexpected response format");
  return r.data[1];
}

function lang(code: string | undefined): "fi" | "sv" | "en" | undefined {
  return code === "fi" || code === "sv" || code === "en" ? code : undefined;
}

export async function runSuggest(
  o: SuggestOptions,
  http: HttpJson,
  cache: DiskCache,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => setTimeout(r, ms)),
): Promise<SuggestResult> {
  const l = lang(o.lang ?? o.hl);
  const letters =
    o.expand === "alphabet" || o.expand === "both" ? alphabetFor(l) : [];
  const templates =
    o.expand === "questions" || o.expand === "both" ? questionTemplates(l) : [];

  const seeds = [...new Set(o.seeds.map((s) => s.trim()).filter(Boolean))].sort(
    (a, b) => cmp(a, b),
  );
  const jobs: { seed: string; expansion: string; q: string }[] = [];
  for (const seed of seeds) {
    const variants = [
      { expansion: "", q: seed },
      ...letters.map((x) => ({ expansion: x, q: `${seed} ${x}` })),
      ...templates.map((t) => ({ expansion: t, q: `${t} ${seed}` })),
    ];
    variants.sort((a, b) => cmp(a.expansion, b.expansion));
    for (const v of variants) jobs.push({ seed, ...v });
  }

  const base = (o.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
  const byQuery = new Map<string, SuggestRow>();
  const errors: ResearchError[] = [];
  let networkCalls = 0;

  for (const job of jobs) {
    const key = `suggest|${o.hl}|${o.gl}|${job.q}`;
    try {
      let suggestions: string[] | undefined;
      if (!o.refresh) {
        const hit = await cache.get(key);
        if (hit !== undefined) {
          try {
            suggestions = parseAnswer(hit);
          } catch {
            suggestions = undefined; // corrupt cache entry = miss
          }
        }
      }
      if (suggestions === undefined) {
        if (networkCalls > 0 && o.delayMs > 0) await sleep(o.delayMs);
        networkCalls++;
        const url = `${base}/complete/search?client=firefox&hl=${encodeURIComponent(o.hl)}&gl=${encodeURIComponent(o.gl)}&q=${encodeURIComponent(job.q)}`;
        const res = await http.getText(url);
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        suggestions = parseAnswer(res.text);
        await cache.set(key, res.text);
      }
      suggestions.forEach((query, i) => {
        if (!byQuery.has(query)) {
          byQuery.set(query, {
            seed: job.seed,
            expansion: job.expansion,
            query,
            rank: i + 1,
          });
        }
      });
    } catch (e) {
      errors.push({
        source: SOURCE,
        target: job.q,
        message:
          e instanceof Error ? e.message.split("\n")[0] || "failed" : "failed",
      });
    }
  }

  const rows = [...byQuery.values()].sort(
    (a, b) => cmp(a.query, b.query) || cmp(a.seed, b.seed),
  );
  errors.sort((a, b) => cmp(a.target, b.target));
  return { kind: "suggest", rows, errors, attempted: jobs.length };
}
