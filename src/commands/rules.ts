import { UsageError } from "../errors.js";
import { allRules } from "../rules/all.js";
import type { Rule } from "../rules/types.js";

export type RulesFormat = "text" | "json" | "md";

const area = (r: Rule): string => `${r.meta.category}/${r.meta.scope}`;

function row(r: Rule): string[] {
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
  const rules = [...allRules].sort((a, b) =>
    a.meta.id < b.meta.id ? -1 : a.meta.id > b.meta.id ? 1 : 0,
  );
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
  const rule = allRules.find((r) => r.meta.id === id);
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
  if (m.defaultOff) lines.push("Off by default: enable via rules.enable");
  return `${lines.join("\n")}\n`;
}
