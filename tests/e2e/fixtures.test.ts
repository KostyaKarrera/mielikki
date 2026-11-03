import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { allRules } from "../../src/rules/all.js";

const CLI = path.resolve("dist/cli.js");
const SITES = path.resolve("tests/fixtures/sites");
const site = (name: string): string => path.join(SITES, name);
const run = (args: string[], cwd: string) =>
  spawnSync("node", [CLI, ...args], { encoding: "utf8", cwd });

interface Report {
  summary: { pages: number; error: number; warning: number; info: number };
  findings: { ruleId: string; severity: string }[];
}
const report = (name: string, profile: "dev" | "launch"): Report =>
  JSON.parse(
    run(["check", "--profile", profile, "--format", "json"], site(name)).stdout,
  ) as Report;

describe("good fixture", () => {
  it.each(["dev", "launch"] as const)(
    "has no error or warning in the %s profile",
    (profile) => {
      const r = report("good", profile);
      expect(r.summary.pages).toBe(7);
      const bad = r.findings.filter((f) => f.severity !== "info");
      expect(bad).toEqual([]);
    },
  );

  it("exits 0 in both profiles", () => {
    expect(run(["check", "--profile", "dev"], site("good")).status).toBe(0);
    expect(run(["check", "--profile", "launch"], site("good")).status).toBe(0);
  });
});

describe("astro-like fixtures (R16)", () => {
  it("astro-like (production URLs, site configured) is green in launch", () => {
    const r = report("astro-like", "launch");
    expect(r.summary.pages).toBe(7);
    expect(r.summary.error).toBe(0);
    expect(r.summary.warning).toBe(0);
    expect(
      run(["check", "--profile", "launch"], site("astro-like")).status,
    ).toBe(0);
  });

  it("astro-localhost (localhost URLs, no site) is red in launch", () => {
    const r = report("astro-localhost", "launch");
    const errors = new Set(
      r.findings.filter((f) => f.severity === "error").map((f) => f.ruleId),
    );
    expect([...errors].sort()).toEqual([
      "core/canonical-invalid",
      "crawl/site-url-not-configured",
      "crawl/sitemap-foreign-host",
    ]);
    expect(
      run(["check", "--profile", "launch"], site("astro-localhost")).status,
    ).toBe(1);
  });
});

/** Replaces tool.version so a version bump does not break snapshots. */
const PKG_VERSION = (
  JSON.parse(readFileSync("package.json", "utf8")) as { version: string }
).version;
const normalizeVersion = (json: string): string => {
  const marker = `"version": ${JSON.stringify(PKG_VERSION)}`;
  expect(json).toContain(marker);
  return json.replace(marker, '"version": "<version>"');
};

describe("broken fixtures", () => {
  const dirs = readdirSync(SITES).filter((d) => d.startsWith("broken-"));
  const fired = new Set<string>();
  beforeAll(() => {
    for (const d of dirs)
      for (const f of report(d, "launch").findings)
        if (f.severity === "error") fired.add(f.ruleId);
  });

  it("exist", () => {
    expect(dirs.length).toBeGreaterThanOrEqual(3);
  });

  it("every launch-blocking rule fires as an error in some fixture", () => {
    // schema/validation is not launchBlocking; it errors only on invalid structured data
    const blocking = allRules
      .filter(
        (r) =>
          r.meta.launchBlocking &&
          r.meta.inputs.includes("dir") && // url-only rules are covered in tests/unit/rules/http
          r.meta.id !== "schema/validation" &&
          // dir mode parses in-process and cannot be made to time out or run out of
          // memory deterministically; covered in url mode by tests/e2e/hostile-pages.test.ts
          r.meta.id !== "crawl/page-unparseable",
      )
      .map((r) => r.meta.id)
      .sort();
    expect(blocking.length).toBeGreaterThan(20);
    expect(blocking.filter((id) => !fired.has(id))).toEqual([]);
  });

  it("each fixture exits 1", () => {
    for (const d of dirs)
      expect(run(["check", "--profile", "launch"], site(d)).status).toBe(1);
  });

  it("json report is deterministic (snapshot)", async () => {
    const r = run(
      ["check", "--profile", "launch", "--format", "json"],
      site("broken-c"),
    );
    await expect(normalizeVersion(r.stdout)).toMatchFileSnapshot(
      "__snapshots__/broken-c.launch.json",
    );
    expect(
      run(
        ["check", "--profile", "launch", "--format", "json"],
        site("broken-c"),
      ).stdout,
    ).toBe(r.stdout);
  });
});

describe("prelaunch fixture", () => {
  it("exits 0 in dev and 1 in launch", () => {
    expect(run(["check"], site("prelaunch")).status).toBe(0);
    expect(
      run(["check", "--profile", "launch"], site("prelaunch")).status,
    ).toBe(1);
  });
});

describe("check options", () => {
  it("--fail-on controls the exit code by severity reached", () => {
    // good has only info findings
    expect(run(["check", "--fail-on", "warning"], site("good")).status).toBe(0);
    expect(run(["check", "--fail-on", "info"], site("good")).status).toBe(1);
    // broken-c has errors
    expect(run(["check", "--fail-on", "error"], site("broken-c")).status).toBe(
      1,
    );
  });

  it("--output writes the report to a file and prints nothing", () => {
    const out = path.join(
      mkdtempSync(path.join(os.tmpdir(), "mielikki-out-")),
      "r.json",
    );
    const r = run(["check", "--format", "json", "--output", out], site("good"));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(
      (JSON.parse(readFileSync(out, "utf8")) as Report).summary.pages,
    ).toBe(7);
  });

  it("--profile launch raises blocking findings to errors", () => {
    const dev = report("broken-c", "dev");
    const launch = report("broken-c", "launch");
    expect(launch.summary.error).toBeGreaterThan(dev.summary.error);
  });

  it("--rules limits the rules that run", () => {
    const r = JSON.parse(
      run(
        ["check", "--rules", "crawl/robots-*", "--format", "json"],
        site("broken-c"),
      ).stdout,
    ) as Report;
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.findings.every((f) => f.ruleId.startsWith("crawl/robots-"))).toBe(
      true,
    );
  });

  it("uses config.input.dir when no directory is given", () => {
    const r = run(["check", "--format", "json"], site("good"));
    expect(
      (JSON.parse(r.stdout) as { input: { root: string } }).input.root,
    ).toBe("dist");
  });
});

describe("docs", () => {
  it("docs/rules.md is up to date (run `npm run docs:rules`)", () => {
    const generated = run(["rules", "--format", "md"], process.cwd()).stdout;
    expect(readFileSync("docs/rules.md", "utf8")).toBe(generated);
  });
});
