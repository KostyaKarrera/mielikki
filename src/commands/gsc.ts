import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../config/load.js";
import { UsageError } from "../errors.js";
import {
  createGscClient,
  GscQuotaError,
  type InspectRow,
  type QueryRow,
} from "../gsc/api.js";
import { matchQueriesToTargets } from "../gsc/match.js";
import {
  DEFAULT_TOKEN_URI,
  defaultOpenUrl,
  getAccessToken,
  loadAdc,
  readClientFile,
  refreshAccess,
  runLoopbackLogin,
  SCOPE,
} from "../gsc/oauth.js";
import { tokenPath } from "../gsc/paths.js";
import { redact } from "../gsc/redact.js";
import { clearToken, loadToken, saveToken } from "../gsc/token-store.js";
import { getLang } from "../lang/index.js";
import { createFetcher, type Fetcher } from "../net/fetch.js";
import { parseSitemap } from "../parse/sitemap.js";
import { createHttpJson, type HttpJson } from "../research/http.js";
import { renderData } from "../research/output.js";
import type { DataFile, ResearchError } from "../research/types.js";
import { VERSION } from "../version.js";

export interface GscIO {
  write(s: string): void;
  warn?(s: string): void;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

export interface GscAuthOptions {
  client?: string;
  adc: boolean;
  logout: boolean;
  noOpen: boolean;
}

/** Test seams only; the CLI never sets these. */
export interface GscDeps {
  http?: HttpJson;
  openUrl?: (url: string) => void;
  /** Fake endpoints for tests; the CLI never sets these. */
  authUri?: string;
  tokenUri?: string;
  timeoutMs?: number;
  inspectBase?: string;
  analyticsBase?: string;
  /** Sitemap fetcher (default: real one restricted to the config.site host). */
  fetcher?: Fetcher;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

const HELP = [
  "No stored Search Console access. Options:",
  "  1. mielikki gsc auth --client client.json - an OAuth client of type 'Desktop app'",
  "     (Google Cloud Console: APIs & Services, enable the Search Console API,",
  "     Credentials, Create OAuth client ID, Desktop app, download the JSON).",
  "  2. mielikki gsc auth --adc - Application Default Credentials",
  "     (gcloud auth application-default login with the webmasters.readonly scope).",
  "Details: docs/gsc.md.",
].join("\n");

const defaultHttp = (): HttpJson =>
  createHttpJson({
    userAgent: `Mielikki/${VERSION} (+https://github.com/KostyaKarrera/mielikki)`,
    timeoutMs: 15000,
  });

export async function runGscAuth(
  o: GscAuthOptions,
  io: GscIO,
  deps: GscDeps = {},
): Promise<number> {
  const warn = io.warn ?? (() => {});
  const file = tokenPath(io.env ?? process.env, io.home ?? os.homedir());
  try {
    if (o.adc && o.client)
      throw new UsageError("Give either --adc or --client, not both");
    if (o.logout) {
      const had = await loadToken(file);
      await clearToken(file);
      io.write(
        `Local token deleted (or there was none); the grant stays valid until you revoke it at myaccount.google.com/permissions.${
          had?.source === "adc" ? " gcloud's own copy (ADC) is untouched." : ""
        }\n`,
      );
      return 0;
    }
    if (o.adc) {
      const t = await loadAdc(io.env ?? process.env, io.home ?? os.homedir());
      if (!t)
        throw new UsageError(
          "ADC not found: run gcloud auth application-default login or set GOOGLE_APPLICATION_CREDENTIALS",
        );
      const http = deps.http ?? defaultHttp();
      const r = await refreshAccess(
        t,
        http,
        deps.tokenUri ?? DEFAULT_TOKEN_URI,
      );
      if (!r.scope.includes(SCOPE))
        throw new UsageError(
          `ADC lacks the webmasters.readonly scope: gcloud auth application-default login --scopes=${SCOPE},https://www.googleapis.com/auth/cloud-platform`,
        );
      await saveToken(file, t);
      io.write("Authorized (source adc).\n");
      return 0;
    }
    if (o.client) {
      const c = await readClientFile(o.client);
      if (deps.authUri) c.authUri = deps.authUri;
      if (deps.tokenUri) c.tokenUri = deps.tokenUri;
      const http = deps.http ?? defaultHttp();
      const t = await runLoopbackLogin(
        c,
        {
          openUrl: o.noOpen ? () => {} : (deps.openUrl ?? defaultOpenUrl),
          print: (s) => io.write(`${s}\n`),
          warn,
          timeoutMs: deps.timeoutMs ?? 300_000,
        },
        http,
      );
      await saveToken(file, t);
      io.write("Authorized (source oauth-client).\n");
      return 0;
    }
    const existing = await loadToken(file);
    if (existing) {
      io.write(`Already authorized (source ${existing.source}).\n`);
      return 0;
    }
    warn(HELP);
    return 2;
  } catch (err) {
    if (err instanceof UsageError) {
      warn(`mielikki: ${err.message.split("\n")[0]}`);
      return 2;
    }
    warn("mielikki: gsc auth failed");
    return 2;
  }
}

export interface GscRunIO extends GscIO {
  cwd: string;
}

export interface GscInspectOptions {
  config?: string;
  site?: string;
  from: "sitemap" | "targets";
  limit: number;
  format: "json" | "csv" | "md";
  output?: string;
  noMeta: boolean;
}

export interface GscQueriesOptions {
  config?: string;
  site?: string;
  days: number;
  rowLimit: number;
  byTarget: boolean;
  format: "json" | "csv" | "md";
  output?: string;
  noMeta: boolean;
}

/** Interval between Search Console calls (600 per minute at most). */
const MIN_INTERVAL_MS = 100;
/** Search Console data lags about two days. */
const LAG_DAYS = 2;
const MAX_SITEMAPS = 20;
const MAX_REDIRECTS = 3;
/** Rows per Search Analytics request (API maximum). */
const PAGE_SIZE = 25_000;
/** Overall cap of rows fetched by pagination. */
export const MAX_ROW_LIMIT = 100_000;
/** Consecutive 5xx/transport failures after which the inspect run stops. */
const MAX_CONSECUTIVE_FAILURES = 5;

const INSPECT_COLUMNS: (keyof InspectRow & string)[] = [
  "url",
  "verdict",
  "coverageState",
  "indexingState",
  "robotsTxtState",
  "pageFetchState",
  "googleCanonical",
  "userCanonical",
  "lastCrawlTime",
];
const QUERY_COLUMNS: (keyof QueryRow & string)[] = [
  "query",
  "page",
  "clicks",
  "impressions",
  "ctr",
  "position",
];

interface TargetRow {
  target: string;
  primary: string;
  status: string;
  queries: number;
  impressions: number;
  clicks: number;
  bestPosition: number | null;
  topQueries: string;
  otherPages: string;
}
const TARGET_COLUMNS: (keyof TargetRow & string)[] = [
  "target",
  "primary",
  "status",
  "queries",
  "impressions",
  "clicks",
  "bestPosition",
  "topQueries",
  "otherPages",
];

const clean = (s: string): string =>
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strips control characters from shown text
  s.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 300);

interface Access {
  token: string;
  secrets: string[];
}

/** Stored token, then ADC; the access token lives only in memory. */
async function resolveAccess(io: GscIO, deps: GscDeps): Promise<Access> {
  const env = io.env ?? process.env;
  const home = io.home ?? os.homedir();
  const stored =
    (await loadToken(tokenPath(env, home))) ?? (await loadAdc(env, home));
  if (!stored) throw new UsageError(HELP);
  const token = await getAccessToken(
    stored,
    deps.http ?? defaultHttp(),
    deps.tokenUri ?? DEFAULT_TOKEN_URI,
  );
  return {
    token,
    secrets: [token, stored.refreshToken, stored.clientSecret ?? ""],
  };
}

async function writeOutput(
  text: string,
  output: string | undefined,
  io: GscRunIO,
  warn: (s: string) => void,
): Promise<boolean> {
  if (!output) {
    io.write(text);
    return true;
  }
  const target = path.resolve(io.cwd, output);
  try {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    warn(
      `mielikki: cannot write ${output}${typeof code === "string" ? ` (${code})` : ""}`,
    );
    return false;
  }
}

/** GET following only same-origin redirects (scheme+host+port); the Fetcher never follows them itself. */
async function getSameOrigin(
  fetcher: Fetcher,
  url: string,
  site: URL,
): Promise<{ status: number; body?: string } | undefined> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const rec = await fetcher.get(current);
    if (rec.final) {
      return new URL(rec.final.url).origin === site.origin
        ? { status: rec.final.status, body: rec.final.body }
        : undefined;
    }
    const last = rec.hops[rec.hops.length - 1];
    if (rec.stop !== "left-site" || !last?.location) return undefined;
    let next: URL;
    try {
      next = new URL(last.location, last.url);
    } catch {
      return undefined;
    }
    if (next.origin !== site.origin) return undefined;
    current = next.href;
  }
  return undefined;
}

async function collectSitemapUrls(
  site: URL,
  fetcher: Fetcher,
): Promise<string[]> {
  const queue = [new URL("/sitemap.xml", site).href];
  const seen = new Set<string>();
  const urls = new Set<string>();
  let first = true;
  while (queue.length > 0 && seen.size < MAX_SITEMAPS) {
    const loc = queue.shift() as string;
    if (seen.has(loc)) continue;
    seen.add(loc);
    const rec = await getSameOrigin(fetcher, loc, site);
    const body = rec?.status === 200 ? rec.body : undefined;
    const info = body === undefined ? undefined : parseSitemap(body, loc);
    if (!info?.ok) {
      if (first)
        throw new UsageError(
          `Could not fetch the sitemap ${site.origin}/sitemap.xml: check config.site or use --from targets`,
        );
      continue;
    }
    first = false;
    for (const u of info.urls) {
      if (!URL.canParse(u) || new URL(u).origin !== site.origin) continue;
      if (info.isIndex) queue.push(u);
      else urls.add(u);
    }
  }
  return [...urls].sort();
}

function fileOf<T extends object>(
  kind: DataFile<T>["kind"],
  rows: T[],
  errors: ResearchError[],
  noMeta: boolean,
  now: Date,
  params: Record<string, string | number | boolean>,
): DataFile<T> {
  return {
    kind,
    rows,
    errors,
    ...(noMeta
      ? {}
      : { meta: { generatedAt: now.toISOString(), version: VERSION, params } }),
  };
}

export async function runGscInspect(
  o: GscInspectOptions,
  io: GscRunIO,
  deps: GscDeps = {},
): Promise<number> {
  const warn = io.warn ?? (() => {});
  let secrets: string[] = [];
  try {
    const config = await loadConfig(io.cwd, o.config);
    if (!config.site)
      throw new UsageError(
        "Set site in the config: the site address is needed for the page list",
      );
    const site = new URL(config.site);
    const siteUrl = o.site ?? `${config.site.replace(/\/+$/, "")}/`;
    const access = await resolveAccess(io, deps);
    secrets = access.secrets;

    let urls: string[];
    if (o.from === "targets") {
      urls = [
        ...new Set(
          config.targets.pages
            .map((p) => new URL(p.url, site).href)
            .filter((u) => new URL(u).origin === site.origin),
        ),
      ].sort();
    } else {
      const fetcher =
        deps.fetcher ??
        createFetcher({
          userAgent: `Mielikki/${VERSION} (+https://github.com/KostyaKarrera/mielikki)`,
          timeoutMs: 15000,
          maxBytes: 5_000_000,
          maxHops: 3,
          concurrency: 1,
          delayMs: 0,
          // redirects are followed by getSameOrigin (origin incl. port)
          allowRedirectHost: () => false,
        });
      urls = await collectSitemapUrls(site, fetcher);
    }
    if (urls.length === 0)
      throw new UsageError("No pages to inspect (the URL list is empty)");
    const total = urls.length;
    urls = urls.slice(0, o.limit);

    const sleep =
      deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const client = createGscClient(
      access.token,
      deps.http ?? defaultHttp(),
      { inspect: deps.inspectBase, analytics: deps.analyticsBase },
      sleep,
    );
    const language = config.language ?? "en";
    const rows: InspectRow[] = [];
    const errors: ResearchError[] = [];
    let quota: GscQuotaError | undefined;
    let fatal: UsageError | undefined;
    let aborted = false;
    let streak = 0;
    for (const [i, u] of urls.entries()) {
      if (i > 0) await sleep(MIN_INTERVAL_MS);
      try {
        rows.push(await client.inspectUrl(siteUrl, u, language));
        streak = 0;
      } catch (e) {
        if (e instanceof GscQuotaError) {
          quota = new GscQuotaError(rows.length);
          break;
        }
        if (e instanceof UsageError) {
          fatal = e;
          break;
        }
        errors.push({
          source: "gsc-inspect",
          target: clean(u),
          message: clean(
            redact(e instanceof Error ? e.message : "failed", secrets),
          ),
        });
        if (++streak >= MAX_CONSECUTIVE_FAILURES) {
          aborted = true;
          break;
        }
      }
    }
    rows.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));

    const file = fileOf(
      "gsc-inspect",
      rows,
      errors,
      o.noMeta,
      (deps.now ?? (() => new Date()))(),
      {
        site: siteUrl,
        from: o.from,
        limit: o.limit,
      },
    );
    const text = redact(renderData(file, o.format, INSPECT_COLUMNS), secrets);
    if (rows.length > 0 || errors.length > 0 || !fatal)
      if (!(await writeOutput(text, o.output, io, warn))) return 2;
    if (fatal) throw fatal;

    const byVerdict = new Map<string, number>();
    for (const r of rows)
      byVerdict.set(r.verdict, (byVerdict.get(r.verdict) ?? 0) + 1);
    const counts = [...byVerdict]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([v, n]) => `${clean(v)} ${n}`)
      .join(", ");
    warn(
      `gsc inspect: inspected ${rows.length} of ${urls.length}${counts ? ` (${counts})` : ""}`,
    );
    const notIndexed = rows.filter((r) => r.verdict !== "PASS");
    if (notIndexed.length > 0) {
      warn(`Not indexed or with issues: ${notIndexed.length}`);
      for (const r of notIndexed.slice(0, 10))
        warn(`  ${r.verdict} ${clean(r.url)} (${clean(r.coverageState)})`);
    }
    if (total > urls.length)
      warn(
        `${total - urls.length} more ${total - urls.length === 1 ? "page" : "pages"} not inspected because of --limit ${o.limit}`,
      );
    if (quota) {
      warn(
        `mielikki: inspected ${quota.done} of ${urls.length}; Search Console quota exhausted (limits are per day), try again later`,
      );
      return 1;
    }
    if (aborted) {
      warn(
        `mielikki: stopped after ${MAX_CONSECUTIVE_FAILURES} consecutive failures; inspected ${rows.length} of ${urls.length}`,
      );
      return 1;
    }
    if (errors.length > 0) {
      warn(`${errors.length} requests failed (see errors in the data)`);
      return 1;
    }
    return 0;
  } catch (err) {
    if (err instanceof UsageError) {
      warn(`mielikki: ${redact(err.message, secrets)}`);
      return 2;
    }
    throw err;
  }
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function runGscQueries(
  o: GscQueriesOptions,
  io: GscRunIO,
  deps: GscDeps = {},
): Promise<number> {
  const warn = io.warn ?? (() => {});
  let secrets: string[] = [];
  try {
    const config = await loadConfig(io.cwd, o.config);
    const siteUrl =
      o.site ?? (config.site ? `${config.site.replace(/\/+$/, "")}/` : "");
    if (!siteUrl) throw new UsageError("Give --site or set site in the config");
    const access = await resolveAccess(io, deps);
    secrets = access.secrets;

    const now = (deps.now ?? (() => new Date()))();
    const day = 86_400_000;
    const today = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );
    const end = new Date(today - LAG_DAYS * day);
    const start = new Date(end.getTime() - (o.days - 1) * day);
    const client = createGscClient(
      access.token,
      deps.http ?? defaultHttp(),
      { inspect: deps.inspectBase, analytics: deps.analyticsBase },
      deps.sleep,
    );
    const rows: QueryRow[] = [];
    try {
      for (;;) {
        const size = Math.min(PAGE_SIZE, o.rowLimit - rows.length);
        const page = await client.queryAnalytics(siteUrl, {
          startDate: isoDay(start),
          endDate: isoDay(end),
          rowLimit: size,
          startRow: rows.length,
        });
        rows.push(...page);
        if (page.length < size || rows.length >= o.rowLimit) break;
        await (deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(
          MIN_INTERVAL_MS,
        );
      }
    } catch (e) {
      if (e instanceof GscQuotaError) {
        warn("mielikki: Search Console quota exhausted; try again later");
        return 1;
      }
      if (e instanceof UsageError) throw e;
      warn(
        `mielikki: ${clean(redact(e instanceof Error ? e.message : "request failed", secrets))}`,
      );
      return 1;
    }
    rows.sort(
      (a, b) =>
        b.impressions - a.impressions ||
        (a.query < b.query ? -1 : a.query > b.query ? 1 : 0) ||
        (a.page < b.page ? -1 : a.page > b.page ? 1 : 0),
    );
    const params = {
      site: siteUrl,
      startDate: isoDay(start),
      endDate: isoDay(end),
      rowLimit: o.rowLimit,
    };
    let text: string;
    if (o.byTarget) {
      const cov = matchQueriesToTargets(rows, config, getLang(config.language));
      const targetRows: TargetRow[] = cov.map((c) => ({
        target: c.target,
        primary: c.primary,
        status: c.status,
        queries: c.matched.length,
        impressions: c.impressions,
        clicks: c.clicks,
        bestPosition: c.bestPosition,
        topQueries: c.matched
          .slice(0, 5)
          .map((r) => r.query)
          .join("; "),
        otherPages: c.otherPages.join("; "),
      }));
      text = renderData(
        fileOf("gsc-queries", targetRows, [], o.noMeta, now, {
          ...params,
          byTarget: true,
        }),
        o.format,
        TARGET_COLUMNS,
      );
      for (const c of cov)
        if (c.status !== "ranking")
          warn(
            `${c.status === "no-data" ? "No data" : "Only other pages"}: ${clean(c.target)} ("${clean(c.primary)}")`,
          );
    } else {
      text = renderData(
        fileOf("gsc-queries", rows, [], o.noMeta, now, params),
        o.format,
        QUERY_COLUMNS,
      );
    }
    if (!(await writeOutput(redact(text, secrets), o.output, io, warn)))
      return 2;
    if (rows.length >= o.rowLimit)
      warn(
        `data truncated to ${o.rowLimit} rows; raise --row-limit (at most ${PAGE_SIZE} per request, paginated up to ${MAX_ROW_LIMIT})`,
      );
    warn(
      `gsc queries: ${rows.length} rows (${params.startDate} to ${params.endDate})`,
    );
    return 0;
  } catch (err) {
    if (err instanceof UsageError) {
      warn(`mielikki: ${redact(err.message, secrets)}`);
      return 2;
    }
    throw err;
  }
}
