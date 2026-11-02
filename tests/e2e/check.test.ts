import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CLI = path.resolve("dist/cli.js");
const run = (args: string[], cwd?: string) =>
  spawnSync("node", [CLI, ...args], { encoding: "utf8", cwd });
const PKG_VERSION = (
  JSON.parse(readFileSync("package.json", "utf8")) as { version: string }
).version;
const tmp = () => mkdtempSync(path.join(os.tmpdir(), "mielikki-e2e-"));

describe("check / rules", () => {
  it("check on empty dir → exit 2", () => {
    const r = run(["check", tmp()]);
    expect(r.status).toBe(2);
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
  });

  it("check on missing dir → exit 2", () => {
    expect(run(["check", "/nonexistent-mielikki-dir"]).status).toBe(2);
  });

  it("check --format json parses", () => {
    const cwd = tmp();
    mkdirSync(path.join(cwd, "dist"));
    writeFileSync(
      path.join(cwd, "dist", "index.html"),
      '<html lang="fi-FI"><head><title>x</title></head><body>hi</body></html>',
    );
    const r = run(
      [
        "check",
        "dist",
        "--format",
        "json",
        "--rules",
        "core/h1-missing,crawl/robots-missing",
      ],
      cwd,
    );
    expect(r.status).toBe(1); // missing H1 and robots.txt are errors
    const j = JSON.parse(r.stdout);
    // the version is checked here, then normalized so releases keep the snapshot
    expect(j.tool.version).toBe(PKG_VERSION);
    j.tool.version = "<version>";
    expect(j).toMatchInlineSnapshot(`
      {
        "findings": [
          {
            "fix": "Add one H1 that describes the page.",
            "message": "/ has no H1",
            "ruleId": "core/h1-missing",
            "severity": "error",
            "url": "/",
          },
          {
            "fix": "Add a /robots.txt that allows crawling and lists the sitemap.",
            "message": "No /robots.txt found",
            "ruleId": "crawl/robots-missing",
            "severity": "error",
          },
        ],
        "input": {
          "kind": "dir",
          "root": "dist",
        },
        "language": "fi",
        "profile": "dev",
        "schemaVersion": 1,
        "summary": {
          "error": 2,
          "info": 0,
          "pages": 1,
          "warning": 0,
        },
        "tool": {
          "name": "mielikki",
          "version": "<version>",
        },
      }
    `);
  });

  it("prelaunch business site without schema: dev exit 0, launch exit 1", () => {
    const cwd = tmp();
    mkdirSync(path.join(cwd, "dist"));
    writeFileSync(
      path.join(cwd, "dist", "index.html"),
      '<html lang="fi"><head><title>x</title></head><body><h1>x</h1></body></html>',
    );
    writeFileSync(
      path.join(cwd, "mielikki.config.yaml"),
      "prelaunch: true\nbusiness:\n  type: service-area\n  schemaType: Electrician\n  name: Testi Oy\n",
    );
    const args = ["check", "--rules", "schema/business-missing"];
    expect(run(args, cwd).status).toBe(0);
    expect(run([...args, "--profile", "launch"], cwd).status).toBe(1);
  });

  it("warns once per rules entry that matches no rule; exit code unaffected", () => {
    const cwd = tmp();
    mkdirSync(path.join(cwd, "dist"));
    writeFileSync(
      path.join(cwd, "dist", "index.html"),
      '<html lang="fi"><head><title>x</title></head><body><h1>x</h1></body></html>',
    );
    writeFileSync(
      path.join(cwd, "mielikki.config.yaml"),
      [
        "rules:",
        "  disable: [x/y, images/*]",
        "  enable: [nope/*]",
        "  severity: { core/titel-length: info, core/title-length: info }",
        "  launchBlocking: { a/b: false }",
        "  options: { c/d: { min: 1 } }",
        "",
      ].join("\n"),
    );
    const args = ["check", "--rules", "core/h1-missing"];
    const r = run(args, cwd);
    expect(r.status).toBe(0);
    expect(r.stderr.trim().split("\n")).toEqual([
      'mielikki: warning: rules.disable "x/y" matches no rule',
      'mielikki: warning: rules.enable "nope/*" matches no rule',
      'mielikki: warning: rules.severity "core/titel-length" matches no rule',
      'mielikki: warning: rules.launchBlocking "a/b" matches no rule',
      'mielikki: warning: rules.options "c/d" matches no rule',
    ]);
  });

  it("bad config → exit 2, stderr has field path", () => {
    const cwd = tmp();
    mkdirSync(path.join(cwd, "dist"));
    writeFileSync(path.join(cwd, "dist", "index.html"), "<html></html>");
    writeFileSync(path.join(cwd, "mielikki.config.yaml"), "input:\n  dir: 5\n");
    const r = run(["check"], cwd);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("input.dir");
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
  });

  it("invalid --fail-on is a usage error (2)", () => {
    expect(run(["check", ".", "--fail-on", "bogus"]).status).toBe(2);
  });

  it("rules explain unknown → exit 2", () => {
    const r = run(["rules", "explain", "no/such-rule"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("no/such-rule");
  });

  it("rules lists (json)", () => {
    const r = run(["rules", "--format", "json"]);
    expect(r.status).toBe(0);
    expect(Array.isArray(JSON.parse(r.stdout))).toBe(true);
  });
});
