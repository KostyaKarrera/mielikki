import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config/load.js";
import { createDiskCache, nullCache } from "../research/cache.js";
import { createHttpJson, type HttpJson } from "../research/http.js";
import { renderData } from "../research/output.js";
import { runSuggest, type SuggestRow } from "../research/suggest.js";
import { VERSION } from "../version.js";

export interface ResearchIO {
  cwd: string;
  write(s: string): void;
  warn?(s: string): void;
}

export interface ResearchSuggestOptions {
  config?: string;
  fromConfig: boolean;
  hl?: string;
  gl?: string;
  expand: "none" | "alphabet" | "questions" | "both";
  delay: number;
  format: "json" | "csv" | "md";
  output?: string;
  noMeta: boolean;
  refresh: boolean;
  noCache: boolean;
}

/** Test seams only; the CLI never sets these. */
export interface ResearchDeps {
  http?: HttpJson;
  baseUrl?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COLUMNS: (keyof SuggestRow & string)[] = [
  "seed",
  "expansion",
  "query",
  "rank",
];

export async function runResearchSuggest(
  seeds: string[],
  opts: ResearchSuggestOptions,
  io: ResearchIO,
  deps: ResearchDeps = {},
): Promise<number> {
  const warn = io.warn ?? (() => {});
  if (seeds.length === 0 && !opts.fromConfig) {
    warn("mielikki: укажите основы или --from-config");
    return 2;
  }
  const config = await loadConfig(io.cwd, opts.config);
  const all = [...seeds];
  if (opts.fromConfig) {
    for (const p of config.targets.pages) all.push(p.primary, ...p.secondary);
  }
  const unique = [
    ...new Set(all.map((s) => s.normalize("NFC").trim()).filter(Boolean)),
  ];
  if (unique.length === 0) {
    warn(
      "mielikki: укажите основы или --from-config (в конфиге нет targets.pages)",
    );
    return 2;
  }

  const hl = opts.hl ?? config.language ?? "en";
  const gl = (opts.gl ?? config.region ?? hl).toLowerCase();
  const http =
    deps.http ??
    createHttpJson({
      userAgent: `Mielikki/${VERSION} (+https://github.com/KostyaKarrera/mielikki)`,
      timeoutMs: 15000,
    });
  const cache = opts.noCache
    ? nullCache
    : createDiskCache(path.join(io.cwd, ".mielikki", "cache"), CACHE_TTL_MS);

  const result = await runSuggest(
    {
      seeds: unique,
      hl,
      gl,
      expand: opts.expand,
      delayMs: opts.delay,
      baseUrl: deps.baseUrl,
      lang: hl,
      refresh: opts.refresh,
    },
    http,
    cache,
    deps.sleep,
  );

  const failed = result.attempted - result.succeeded;
  if (result.attempted > 0 && result.succeeded === 0) {
    const msgs = [...new Set(result.errors.map((e) => e.message))].slice(0, 3);
    warn(
      `Google Suggest unavailable: ${msgs.join("; ") || "no response"} (${failed} of ${result.attempted} requests failed; try again later)`,
    );
    return 1;
  }

  const file = {
    kind: result.kind,
    rows: result.rows,
    errors: result.errors,
    ...(opts.noMeta
      ? {}
      : {
          meta: {
            generatedAt: (deps.now ?? (() => new Date()))().toISOString(),
            version: VERSION,
            params: {
              hl,
              gl,
              expand: opts.expand,
              seeds: unique.length,
            },
          },
        }),
  };
  const text = renderData(file, opts.format, COLUMNS);
  if (opts.output) {
    const target = path.resolve(io.cwd, opts.output);
    try {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, text);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      warn(
        `mielikki: cannot write ${opts.output}${typeof code === "string" ? ` (${code})` : ""}`,
      );
      return 2;
    }
  } else {
    io.write(text);
  }
  if (result.errors.length > 0) {
    warn(
      `${failed} of ${result.attempted} requests failed (see errors in the output)`,
    );
  }
  return 0;
}
