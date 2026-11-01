import pc from "picocolors";
import type { Severity } from "../config/schema.js";
import {
  atLeast,
  type CheckResult,
  groupByRule,
  ruleLabel,
  SEVERITIES,
} from "./result.js";

export function renderText(
  r: CheckResult,
  opts: { color: boolean; minSeverity: Severity },
): string {
  const c = pc.createColors(opts.color);
  const paint: Record<Severity, (s: string) => string> = {
    error: c.red,
    warning: c.yellow,
    info: c.cyan,
  };
  const { summary: s } = r;
  const out: string[] = [
    c.bold(
      `mielikki: ${s.pages} ${s.pages === 1 ? "page" : "pages"} checked (${r.profile}, language: ${r.language})`,
    ),
    "",
  ];
  for (const sev of SEVERITIES) {
    if (!atLeast(sev, opts.minSeverity)) continue;
    const list = r.findings.filter((f) => f.severity === sev);
    if (list.length === 0) continue;
    out.push(paint[sev](c.bold(`${sev.toUpperCase()} (${list.length})`)));
    for (const [ruleId, items] of groupByRule(list)) {
      const first = items[0];
      if (!first) continue;
      out.push(`  ${ruleLabel(ruleId)} (${items.length})`);
      for (const f of items) out.push(`    ${f.url ?? "(site)"}: ${f.message}`);
      out.push(c.dim(`    → ${first.fix}`));
    }
    out.push("");
  }
  out.push(`${s.error} errors, ${s.warning} warnings, ${s.info} info`);
  return `${out.join("\n")}\n`;
}
