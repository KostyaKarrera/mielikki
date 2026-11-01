import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config/load.js";
import type { Config, Severity } from "../config/schema.js";
import { loadDir } from "../load/dir.js";
import type { Page } from "../model/types.js";
import { renderJson } from "../report/json.js";
import { renderMarkdown } from "../report/md.js";
import { type CheckResult, exitCodeFor } from "../report/result.js";
import { renderText } from "../report/text.js";
import { allRules } from "../rules/all.js";
import { runRules } from "../rules/engine.js";
import { selectRules } from "../rules/registry.js";
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
}

/** Thrown for launch errors that map to exit code 2. */
export class UsageError extends Error {}

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

export async function runCheck(
  dirArg: string | undefined,
  opts: CheckOptions,
  io: { cwd: string; isTTY: boolean; write(s: string): void },
): Promise<number> {
  const config = await loadConfig(io.cwd, opts.config);
  const dir = path.resolve(io.cwd, dirArg ?? config.input.dir);
  try {
    await readdir(dir);
  } catch {
    throw new UsageError(`Input directory not found: ${dir}`);
  }
  const site = await loadDir(dir, config);
  if (site.pages.length === 0)
    throw new UsageError(`No HTML files found in ${dir}`);

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
    input: { kind: "dir", root: path.relative(io.cwd, dir) || "." },
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
