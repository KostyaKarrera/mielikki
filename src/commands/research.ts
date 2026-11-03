import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config/load.js";
import { createFetcher, type Fetcher } from "../net/fetch.js";
import { parseStartUrl } from "../net/policy.js";
import { createDiskCache, nullCache } from "../research/cache.js";
import {
  analyzeCompetitor,
  type CompetitorReport,
} from "../research/competitors.js";
import { createHttpJson, type HttpJson } from "../research/http.js";
import { renderData } from "../research/output.js";
import { runSuggest, type SuggestRow } from "../research/suggest.js";
import {
  ResearchSourceError,
  runTrends,
  type TrendsRow,
} from "../research/trends.js";
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
  fetcher?: Fetcher;
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

export interface ResearchTrendsOptions {
  config?: string;
  geo?: string;
  hl?: string;
  timeframe: string;
  format: "json" | "csv" | "md";
  output?: string;
  noMeta: boolean;
  refresh: boolean;
  noCache: boolean;
}

const TRENDS_COLUMNS: (keyof TrendsRow & string)[] = [
  "term",
  "weekStart",
  "value",
];

export async function runResearchTrends(
  terms: string[],
  opts: ResearchTrendsOptions,
  io: ResearchIO,
  deps: ResearchDeps = {},
): Promise<number> {
  const warn = io.warn ?? (() => {});
  const unique = [
    ...new Set(terms.map((s) => s.normalize("NFC").trim()).filter(Boolean)),
  ];
  if (unique.length === 0) {
    warn("mielikki: укажите хотя бы один термин");
    return 2;
  }
  const config = await loadConfig(io.cwd, opts.config);
  const hl = opts.hl ?? config.language ?? "en";
  const geo = (opts.geo ?? config.region ?? "").toUpperCase();
  const http =
    deps.http ??
    createHttpJson({
      userAgent: `Mielikki/${VERSION} (+https://github.com/KostyaKarrera/mielikki)`,
      timeoutMs: 15000,
    });
  const cache = opts.noCache
    ? nullCache
    : createDiskCache(path.join(io.cwd, ".mielikki", "cache"), CACHE_TTL_MS);

  let result: Awaited<ReturnType<typeof runTrends>>;
  try {
    // --refresh: bypass reads by using a write-only cache view
    const view = opts.refresh
      ? { get: async () => undefined, set: cache.set.bind(cache) }
      : cache;
    result = await runTrends(
      {
        terms: unique,
        geo,
        hl,
        timeframe: opts.timeframe,
        baseUrl: deps.baseUrl,
      },
      http,
      view,
    );
  } catch (e) {
    if (e instanceof ResearchSourceError) {
      warn(e.message.slice(0, 200));
      return 1;
    }
    throw e;
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
              geo,
              timeframe: opts.timeframe,
              terms: unique.length,
            },
          },
        }),
  };
  const text = renderData(file, opts.format, TRENDS_COLUMNS, {
    summary: result.summary,
  });
  if (opts.format === "csv") {
    warn("mielikki: summary is only included in json/md output");
  }
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
      result.errors
        .map((e) => e.message)
        .join("; ")
        .slice(0, 200),
    );
  }
  return 0;
}

export interface ResearchCompetitorsOptions {
  config?: string;
  maxPages: number;
  delay: number;
  language?: "fi" | "sv" | "en";
  format: "json" | "csv" | "md";
  output?: string;
  noMeta: boolean;
}

const COMPETITOR_COLUMNS: (keyof CompetitorReport & string)[] = [
  "site",
  "sitemapUrls",
  "pagesAnalyzed",
  "stoppedBy",
  "urlPatterns",
  "pages",
  "terms",
  "errors",
];
const COMPETITOR_FLAT_COLUMNS: (keyof CompetitorReport & string)[] = [
  "site",
  "sitemapUrls",
  "pagesAnalyzed",
  "stoppedBy",
];

export async function runResearchCompetitors(
  urls: string[],
  opts: ResearchCompetitorsOptions,
  io: ResearchIO,
  deps: ResearchDeps = {},
): Promise<number> {
  const warn = io.warn ?? (() => {});
  if (urls.length === 0) {
    warn("mielikki: укажите хотя бы один URL сайта конкурента");
    return 2;
  }
  const starts: string[] = [];
  for (const u of urls) {
    try {
      starts.push(parseStartUrl(u).href);
    } catch (e) {
      warn(`mielikki: ${(e as Error).message.slice(0, 200)}`);
      return 2;
    }
  }
  const config = await loadConfig(io.cwd, opts.config);
  const language =
    opts.language ??
    (["fi", "sv", "en"] as const).find(
      (l) => l === config.language?.toLowerCase().split(/[-_]/)[0],
    );
  const areaHints = config.business?.areaServed ?? [];

  warn("research competitors: вежливый обход, robots.txt соблюдается");
  const fetcher =
    deps.fetcher ??
    createFetcher({
      userAgent: `Mielikki/${VERSION} (+https://github.com/KostyaKarrera/mielikki)`,
      timeoutMs: 15000,
      maxBytes: 2_000_000,
      maxHops: 5,
      concurrency: 1,
      delayMs: opts.delay,
      // Redirects are never followed to another host.
      allowRedirectHost: () => false,
    });

  const rows: CompetitorReport[] = [];
  const seenSites = new Set<string>();
  for (const u of starts) {
    if (seenSites.has(u)) continue;
    seenSites.add(u);
    try {
      rows.push(
        await analyzeCompetitor(u, fetcher, {
          maxPages: opts.maxPages,
          language,
          areaHints,
        }),
      );
    } catch (e) {
      rows.push({
        site: new URL(u).origin,
        sitemapUrls: 0,
        pagesAnalyzed: 0,
        stoppedBy: "done",
        urlPatterns: [],
        pages: [],
        terms: [],
        errors: [
          {
            source: "competitors",
            target: u.slice(0, 200),
            message: (e instanceof Error ? e.message : "failed").slice(0, 200),
          },
        ],
      });
    }
  }
  rows.sort((a, b) => (a.site < b.site ? -1 : a.site > b.site ? 1 : 0));

  if (rows.every((r) => r.pagesAnalyzed === 0)) {
    const msgs = [
      ...new Set(rows.flatMap((r) => r.errors.map((e) => e.message))),
    ].slice(0, 3);
    warn(
      `mielikki: ни с одного сайта не получено страниц: ${msgs.join("; ") || "нет ответа"}`.slice(
        0,
        200,
      ),
    );
    return 1;
  }

  const file = {
    kind: "competitors" as const,
    rows,
    errors: [],
    ...(opts.noMeta
      ? {}
      : {
          meta: {
            generatedAt: (deps.now ?? (() => new Date()))().toISOString(),
            version: VERSION,
            params: {
              maxPages: opts.maxPages,
              delay: opts.delay,
              sites: rows.length,
              ...(language ? { language } : {}),
            },
          },
        }),
  };
  const text = renderData(
    file,
    opts.format,
    opts.format === "json" ? COMPETITOR_COLUMNS : COMPETITOR_FLAT_COLUMNS,
  );
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
  return 0;
}
