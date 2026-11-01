import { describe, expect, it } from "vitest";
import { renderJson } from "../../src/report/json.js";
import { renderMarkdown } from "../../src/report/md.js";
import { type CheckResult, exitCodeFor } from "../../src/report/result.js";
import { renderText } from "../../src/report/text.js";

const result: CheckResult = {
  schemaVersion: 1,
  tool: { name: "mielikki", version: "0.1.0" },
  input: { kind: "dir", root: "dist" },
  profile: "dev",
  language: "fi",
  summary: { pages: 2, error: 1, warning: 1, info: 0 },
  findings: [
    {
      ruleId: "meta/title-missing",
      severity: "error",
      url: "/",
      message: "No <title>",
      fix: "Add a title.",
    },
    {
      ruleId: "meta/desc-short",
      severity: "warning",
      url: "/a/",
      message: "Too short",
      fix: "Lengthen it.",
    },
  ],
};

describe("report", () => {
  it("json stable", () => {
    expect(renderJson(result)).toBe(`${JSON.stringify(result, null, 2)}\n`);
    expect(Object.keys(JSON.parse(renderJson(result)))).toEqual([
      "schemaVersion",
      "tool",
      "input",
      "profile",
      "language",
      "summary",
      "findings",
    ]);
  });

  it("exit code by fail-on", () => {
    expect(exitCodeFor(result, "error")).toBe(1);
    const warnOnly = {
      ...result,
      summary: { ...result.summary, error: 0 },
      findings: result.findings.slice(1),
    };
    expect(exitCodeFor(warnOnly, "error")).toBe(0);
    expect(exitCodeFor(warnOnly, "warning")).toBe(1);
    expect(exitCodeFor({ ...warnOnly, findings: [] }, "info")).toBe(0);
  });

  it("md contains summary table", () => {
    const md = renderMarkdown(result);
    expect(md).toContain("| Severity | Count |");
    expect(md).toContain("| error | 1 |");
    expect(md).toContain("meta/title-missing");
  });

  it("text groups by severity and rule, no color codes when color=false", () => {
    const t = renderText(result, { color: false, minSeverity: "info" });
    expect(t).toContain("2 pages");
    expect(t).toContain("meta/title-missing");
    expect(t).toContain("→ Add a title.");
    expect(t).not.toContain("\u001b[");
    const only = renderText(result, { color: false, minSeverity: "error" });
    expect(only).not.toContain("meta/desc-short");
  });
});
