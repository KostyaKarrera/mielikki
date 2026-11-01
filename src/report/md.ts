import {
  type CheckResult,
  groupByRule,
  ruleLabel,
  SEVERITIES,
} from "./result.js";

export function renderMarkdown(r: CheckResult): string {
  const { summary: s } = r;
  const out: string[] = [
    "# Mielikki SEO report",
    "",
    `Input: \`${r.input.root}\` (${r.input.kind}) · profile: ${r.profile} · language: ${r.language} · pages: ${s.pages}`,
    "",
    "| Severity | Count |",
    "| --- | --- |",
    ...SEVERITIES.map((sev) => `| ${sev} | ${s[sev]} |`),
    "",
  ];
  for (const sev of SEVERITIES) {
    const list = r.findings.filter((f) => f.severity === sev);
    if (list.length === 0) continue;
    out.push(`## ${sev[0]?.toUpperCase()}${sev.slice(1)} (${list.length})`, "");
    for (const [ruleId, items] of groupByRule(list)) {
      const first = items[0];
      if (!first) continue;
      out.push(`### ${ruleLabel(ruleId)} (${items.length})`, "");
      for (const f of items) out.push(`- ${f.url ?? "(site)"}: ${f.message}`);
      out.push("", `Fix: ${first.fix}`, "");
    }
  }
  return `${out.join("\n").trimEnd()}\n`;
}
