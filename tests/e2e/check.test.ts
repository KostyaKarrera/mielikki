import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CLI = path.resolve("dist/cli.js");
const run = (args: string[], cwd?: string) =>
  spawnSync("node", [CLI, ...args], { encoding: "utf8", cwd });
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
    const r = run(["check", "dist", "--format", "json"], cwd);
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.schemaVersion).toBe(1);
    expect(j.language).toBe("fi");
    expect(j.input.root).toBe("dist");
    expect(j.summary.pages).toBe(1);
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
