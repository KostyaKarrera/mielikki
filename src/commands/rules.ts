import { UsageError } from "../errors.js";
import { perfRuleMetas } from "../perf/rules.js";
import { allRules } from "../rules/all.js";
import type { RuleMeta } from "../rules/types.js";

export type RulesFormat = "text" | "json" | "md";

interface Entry {
  meta: RuleMeta;
  runBy?: "perf";
}

/** `check` rules plus the metadata of rules only the `perf` command runs. */
const entries = (): Entry[] =>
  [
    ...allRules,
    ...perfRuleMetas.map((meta): Entry => ({ meta, runBy: "perf" })),
  ].sort((a, b) =>
    a.meta.id < b.meta.id ? -1 : a.meta.id > b.meta.id ? 1 : 0,
  );

const area = (r: Entry): string =>
  `${r.meta.category}/${r.meta.scope}${r.runBy ? " (run by perf command)" : ""}`;

function row(r: Entry): string[] {
  const m = r.meta;
  return [m.id, m.severity, m.launchBlocking ? "yes" : "no", area(r), m.source];
}
const HEAD = ["id", "severity", "blocking", "area", "source"];

function pad(rows: string[][]): string {
  const widths = HEAD.map((_, i) =>
    Math.max(...rows.map((r) => (r[i] ?? "").length)),
  );
  return rows
    .map((r) =>
      r
        .map((c, i) => c.padEnd(widths[i] ?? 0))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

export function listRules(format: RulesFormat): string {
  const rules = entries();
  if (format === "json")
    return `${JSON.stringify(
      rules.map((r) => ({
        id: r.meta.id,
        title: r.meta.title,
        severity: r.meta.severity,
        launchBlocking: r.meta.launchBlocking,
        area: area(r),
        source: r.meta.source,
        defaultOff: r.meta.defaultOff ?? false,
        ...(r.runBy ? { runBy: r.runBy } : {}),
      })),
      null,
      2,
    )}\n`;
  if (format === "md")
    return `${[
      `| ${HEAD.join(" | ")} |`,
      `| ${HEAD.map(() => "---").join(" | ")} |`,
      ...rules.map((r) => `| ${row(r).join(" | ")} |`),
    ].join("\n")}\n`;
  return `${pad([HEAD, ...rules.map(row)])}\n`;
}

export function explainRule(id: string): string {
  const rule = entries().find((r) => r.meta.id === id);
  if (!rule) throw new UsageError(`Unknown rule: ${id}`);
  const m = rule.meta;
  const lines = [
    `${m.id} — ${m.title}`,
    `Severity: ${m.severity}${m.launchBlocking ? " (error in launch profile)" : ""}`,
    `Area: ${area(rule)}`,
    `Fix: ${m.fix}`,
    `Source: ${m.source}`,
    `Default options: ${m.defaultOptions ? JSON.stringify(m.defaultOptions) : "none"}`,
  ];
  if (rule.runBy)
    lines.push("Run by: the perf command (mielikki perf <url>), not check");
  if (m.defaultOff) lines.push("Off by default: enable via rules.enable");
  return `${lines.join("\n")}\n`;
}
