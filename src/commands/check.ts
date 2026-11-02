import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config/load.js";
import type { Config, Severity } from "../config/schema.js";
import { UsageError } from "../errors.js";
import { loadDir } from "../load/dir.js";
import { loadUrl } from "../load/url.js";
import { isLocalHost } from "../model/host.js";
import type { Page, Site } from "../model/types.js";
import {
  createFetcher,
  type Fetcher,
  type FetcherOptions,
} from "../net/fetch.js";
import {
  isAssetPath,
  mapToCrawl,
  normalizeCrawlUrl,
  parseStartUrl,
} from "../net/policy.js";
import { renderJson } from "../report/json.js";
import { renderMarkdown } from "../report/md.js";
import { type CheckResult, exitCodeFor } from "../report/result.js";
import { renderText } from "../report/text.js";
import { allRules } from "../rules/all.js";
import { runRules } from "../rules/engine.js";
import { selectRules, unmatchedRuleEntries } from "../rules/registry.js";
import type { Profile } from "../rules/types.js";
import { VERSION } from "../version.js";

export interface CheckOptions {
  config?: string;
  profile: Profile;
  format: "text" | "json" | "md";
  output?: string;
  failOn: Severity;
  rules?: string;
  minSeverity: Severity;
  // URL mode only; ignored for a directory.
  maxPages?: number;
  maxAssets?: number;
  concurrency?: number;
  delay?: number;
  timeout?: number;
  maxBytes?: number;
  respectRobots?: boolean;
}

export interface CheckIO {
  cwd: string;
  isTTY: boolean;
  write(s: string): void;
  warn?(s: string): void;
  /** Fetcher factory for URL mode (tests inject a scripted one). */
  fetcher?(o: FetcherOptions): Fetcher;
}

const USER_AGENT = `Mielikki/${VERSION} (+https://github.com/KostyaKarrera/mielikki)`;
const MAX_REDIRECTS = 10;

const isUrlTarget = (t: string | undefined): t is string =>
  t !== undefined && /^https?:\/\//i.test(t);

async function loadFromDir(
  dirArg: string | undefined,
  config: Config,
  cwd: string,
): Promise<{ site: Site; root: string }> {
  const dir = path.resolve(cwd, dirArg ?? config.input.dir);
  try {
    await readdir(dir);
  } catch {
    throw new UsageError(`Input directory not found: ${dir}`);
  }
  const site = await loadDir(dir, config);
  if (site.pages.length === 0)
    throw new UsageError(`No HTML files found in ${dir}`);
  return { site, root: path.relative(cwd, dir) || "." };
}

async function loadFromUrl(
  target: string,
  config: Config,
  opts: CheckOptions,
  io: CheckIO,
): Promise<{ site: Site; root: string }> {
  const start = parseStartUrl(target);
  if (isAssetPath(start.pathname))
    throw new UsageError(
      `Start URL must be a page, not an asset: ${start.href}`,
    );
  const crawlOrigin = start.origin;
  const siteOrigin =
    config.site !== undefined && URL.canParse(config.site)
      ? new URL(config.site).origin
      : undefined;
  const local = isLocalHost(start.hostname);
  if (!local && crawlOrigin !== siteOrigin)
    io.warn?.(
      "mielikki: warning: checking a site that is not config.site; only audit sites you own or have permission to audit",
    );

  const make = io.fetcher ?? createFetcher;
  const fetcher = make({
    userAgent: USER_AGENT,
    timeoutMs: opts.timeout ?? 15000,
    maxBytes: opts.maxBytes ?? 5_000_000,
    maxHops: MAX_REDIRECTS,
    concurrency: opts.concurrency ?? (local ? 4 : 2),
    delayMs: opts.delay ?? (local ? 0 : 100),
    allowRedirectHost: (h) => h === start.hostname,
    mapUrl: (u) => mapToCrawl(u, crawlOrigin, siteOrigin),
  });
  const site = await loadUrl(start.href, config, fetcher, {
    maxPages: opts.maxPages ?? 200,
    maxAssets: opts.maxAssets ?? 300,
    respectRobots: opts.respectRobots === true,
  });

  const root = new URL(start.href);
  root.search = "";
  root.hash = "";
  const rec = site.responses?.get(normalizeCrawlUrl(start.href).url);
  const reason =
    rec === undefined
      ? "not requested"
      : rec.stop !== undefined
        ? (rec.detail ?? rec.stop)
        : rec.final === undefined
          ? "network"
          : rec.final.status >= 400
            ? `HTTP ${rec.final.status}`
            : undefined;
  if (reason !== undefined)
    throw new UsageError(
      `Start URL is not reachable: ${root.href} (${reason})`,
    );
  if (site.pages.length === 0)
    throw new UsageError(`No HTML pages found at ${root.href}`);
  return { site, root: root.href };
}

const SUPPORTED = ["fi", "sv", "en"] as const;

/** Most frequent primary <html lang> subtag among pages, if fi|sv|en. */
export function detectLanguage(pages: Page[]): Config["language"] {
  const counts = new Map<string, number>();
  for (const p of pages) {
    const base = p.lang?.toLowerCase().split(/[-_]/)[0];
    if (base) counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  let best: string | undefined;
  let max = 0;
  for (const [lang, n] of [...counts].sort(([a], [b]) => (a < b ? -1 : 1)))
    if (n > max) {
      best = lang;
      max = n;
    }
  return SUPPORTED.find((l) => l === best);
}

/** Checks a built directory, or a running site when `target` is an http(s) URL. */
export async function runCheck(
  target: string | undefined,
  opts: CheckOptions,
  io: CheckIO,
): Promise<number> {
  const config = await loadConfig(io.cwd, opts.config);
  for (const w of unmatchedRuleEntries(allRules, config))
    io.warn?.(`mielikki: warning: ${w}`);
  const { site, root } = isUrlTarget(target)
    ? await loadFromUrl(target, config, opts, io)
    : await loadFromDir(target, config, io.cwd);

  const language = config.language ?? detectLanguage(site.pages);
  const effective: Config = language ? { ...config, language } : config;
  site.config = effective;

  const include = opts.rules
    ?.split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const rules = selectRules(allRules, effective, include);
  const findings = await runRules(site, rules, effective, opts.profile);

  const count = (s: Severity): number =>
    findings.filter((f) => f.severity === s).length;
  const result: CheckResult = {
    schemaVersion: 1,
    tool: { name: "mielikki", version: VERSION },
    input: { kind: site.input.kind, root },
    profile: opts.profile,
    language: language ?? "other",
    summary: {
      pages: site.pages.length,
      error: count("error"),
      warning: count("warning"),
      info: count("info"),
    },
    findings,
  };

  const color = opts.output === undefined && io.isTTY;
  const text =
    opts.format === "json"
      ? renderJson(result)
      : opts.format === "md"
        ? renderMarkdown(result)
        : renderText(result, { color, minSeverity: opts.minSeverity });
  if (opts.output) await writeFile(path.resolve(io.cwd, opts.output), text);
  else io.write(text);
  return exitCodeFor(result, opts.failOn);
}
