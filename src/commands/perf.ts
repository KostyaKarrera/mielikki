import { writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config/load.js";
import type { Severity } from "../config/schema.js";
import { UsageError } from "../errors.js";
import { parseStartUrl } from "../net/policy.js";
import { medianLhr, perfFindings } from "../perf/findings.js";
import type { LhrSubset } from "../perf/lhr.js";
import { type LighthouseRunner, loadLighthouseRunner } from "../perf/runner.js";
import { renderJson } from "../report/json.js";
import { renderMarkdown } from "../report/md.js";
import { type CheckResult, exitCodeFor } from "../report/result.js";
import { renderText } from "../report/text.js";
import type { Finding } from "../rules/types.js";
import { VERSION } from "../version.js";

export interface PerfOptions {
  config?: string;
  preset: "mobile" | "desktop";
  runs: number;
  chromePath?: string;
  noSandbox: boolean;
  format: "text" | "json" | "md";
  output?: string;
  failOn: Severity;
}

export interface PerfIO {
  cwd: string;
  isTTY: boolean;
  write(s: string): void;
  warn?(s: string): void;
}

const ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export async function runPerf(
  urls: string[],
  opts: PerfOptions,
  io: PerfIO,
  runner?: LighthouseRunner,
): Promise<number> {
  const config = await loadConfig(io.cwd, opts.config);
  const targets = urls.map((u) => parseStartUrl(u).href);
  if (targets.length === 0) throw new UsageError("perf needs at least one URL");
  const run = runner ?? (await loadLighthouseRunner());

  const findings: Finding[] = [];
  for (const url of targets) {
    try {
      const runs: LhrSubset[] = [];
      for (let i = 0; i < opts.runs; i++)
        runs.push(
          await run(url, {
            preset: opts.preset,
            chromePath: opts.chromePath,
            noSandbox: opts.noSandbox,
          }),
        );
      findings.push(...perfFindings(medianLhr(runs), url));
    } catch (e) {
      if (e instanceof UsageError) throw e;
      findings.push({
        ruleId: "perf/run-failed",
        severity: "warning",
        url,
        message: `Lighthouse failed: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`,
        fix: "Check that the URL is reachable and Chrome is working (try --no-sandbox in containers or CI); the other URLs' results are kept.",
      });
    }
  }
  findings.sort(
    (a, b) =>
      ORDER[a.severity] - ORDER[b.severity] ||
      cmp(a.ruleId, b.ruleId) ||
      cmp(a.url ?? "", b.url ?? "") ||
      cmp(a.message, b.message),
  );

  const count = (s: Severity): number =>
    findings.filter((f) => f.severity === s).length;
  const result: CheckResult = {
    schemaVersion: 1,
    tool: { name: "mielikki", version: VERSION },
    input: { kind: "url", root: targets[0] as string },
    profile: "dev",
    language: config.language ?? "other",
    summary: {
      pages: targets.length,
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
        : renderText(result, { color, minSeverity: "info" });
  if (opts.output) await writeFile(path.resolve(io.cwd, opts.output), text);
  else io.write(text);
  return exitCodeFor(result, opts.failOn);
}
