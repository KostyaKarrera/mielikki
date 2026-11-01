import type { Severity } from "../config/schema.js";
import { allRules } from "../rules/all.js";
import type { Finding, Profile } from "../rules/types.js";

export interface CheckResult {
  schemaVersion: 1;
  tool: { name: "mielikki"; version: string };
  input: { kind: "dir" | "url"; root: string };
  profile: Profile;
  language: string;
  summary: { pages: number; error: number; warning: number; info: number };
  findings: Finding[];
}

export const SEVERITIES: Severity[] = ["error", "warning", "info"];
const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** True when `sev` is at least as important as `threshold`. */
export const atLeast = (sev: Severity, threshold: Severity): boolean =>
  RANK[sev] <= RANK[threshold];

export function exitCodeFor(r: CheckResult, failOn: Severity): 0 | 1 {
  return r.findings.some((f) => atLeast(f.severity, failOn)) ? 1 : 0;
}

/** Findings of one severity grouped by rule, in first-seen (already sorted) order. */
export function groupByRule(findings: Finding[]): Map<string, Finding[]> {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const g = groups.get(f.ruleId);
    if (g) g.push(f);
    else groups.set(f.ruleId, [f]);
  }
  return groups;
}

/** `ruleId — title` when the rule is registered, else just the id. */
export function ruleLabel(ruleId: string): string {
  const rule = allRules.find((r) => r.meta.id === ruleId);
  return rule ? `${ruleId} — ${rule.meta.title}` : ruleId;
}
