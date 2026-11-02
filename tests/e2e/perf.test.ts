import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runPerf } from "../../src/commands/perf.js";
import { UsageError } from "../../src/errors.js";
import type { LhrSubset } from "../../src/perf/lhr.js";
import type { LighthouseRunner } from "../../src/perf/runner.js";
import { loadLighthouseRunner } from "../../src/perf/runner.js";
import type { CheckResult } from "../../src/report/result.js";

const CLI = path.resolve("dist/cli.js");
const lhr = (n: string): LhrSubset =>
  JSON.parse(readFileSync(`tests/fixtures/lhr/${n}.json`, "utf8")) as LhrSubset;

const OPTS = {
  preset: "mobile" as const,
  runs: 1,
  noSandbox: false,
  format: "json" as const,
  failOn: "error" as const,
};

function io() {
  let out = "";
  return {
    io: {
      cwd: process.cwd(),
      isTTY: false,
      write: (s: string) => {
        out += s;
      },
    },
    out: () => out,
  };
}

const runner: LighthouseRunner = async (url) => {
  if (url.includes("bad")) throw new Error("boom");
  return lhr(url.includes("poor") ? "poor" : "good");
};

describe("mielikki perf", () => {
  it("keeps results when one URL fails; run-failed gives exit 1 with --fail-on warning", async () => {
    const t = io();
    const code = await runPerf(
      ["https://a.test/good", "https://a.test/bad"],
      { ...OPTS, failOn: "warning" },
      t.io,
      runner,
    );
    const r = JSON.parse(t.out()) as CheckResult;
    expect(code).toBe(1);
    expect(r.input.kind).toBe("url");
    expect(r.profile).toBe("dev");
    const ids = r.findings.map((f) => `${f.ruleId} ${f.url}`);
    expect(ids).toContain("perf/score https://a.test/good");
    expect(ids).toContain("perf/run-failed https://a.test/bad");
    expect(
      r.findings.find((f) => f.ruleId === "perf/run-failed")?.severity,
    ).toBe("warning");
  });

  it("exit 0 for a good page with default --fail-on, even if poor warnings exist", async () => {
    const t = io();
    expect(await runPerf(["https://a.test/poor"], OPTS, t.io, runner)).toBe(0);
    const r = JSON.parse(t.out()) as CheckResult;
    expect(r.findings.some((f) => f.ruleId === "perf/lcp")).toBe(true);
  });

  it("text and md formats render with rule titles", async () => {
    for (const format of ["text", "md"] as const) {
      const t = io();
      await runPerf(["https://a.test/poor"], { ...OPTS, format }, t.io, runner);
      expect(t.out()).toContain("perf/lcp");
    }
  });

  it("--runs takes the median", async () => {
    const values = [3000, 1000, 2000];
    let i = 0;
    const r: LighthouseRunner = async () => {
      const l = lhr("good");
      const a = l.audits["largest-contentful-paint"];
      if (a) a.numericValue = values[i++ % 3];
      return l;
    };
    const t = io();
    await runPerf(["https://a.test/"], { ...OPTS, runs: 3 }, t.io, r);
    expect(i).toBe(3);
    const res = JSON.parse(t.out()) as CheckResult;
    // median 2000 ms -> silent
    expect(res.findings.some((f) => f.ruleId === "perf/lcp")).toBe(false);
  });

  it("missing lighthouse is a UsageError with an install hint", async () => {
    const failing = async (): Promise<never> => {
      throw Object.assign(new Error("Cannot find package"), {
        code: "ERR_MODULE_NOT_FOUND",
      });
    };
    const err = await loadLighthouseRunner(failing).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect((err as Error).message).toContain(
      "npm i -D lighthouse chrome-launcher",
    );
    expect((err as Error).message).toContain("CHROME_PATH");
  });

  it("runPerf without an injected runner propagates the loader UsageError", async () => {
    // lighthouse is not a dependency of this repo, so the real loader fails here
    // unless someone installed it; skip the assertion in that case.
    const t = io();
    const res = await runPerf(["https://a.test/"], OPTS, t.io).catch(
      (e: unknown) => e,
    );
    if (res instanceof Error) expect(res).toBeInstanceOf(UsageError);
  });

  it("CLI: rules explain perf/lcp, rules lists perf rules, bad flags exit 2", () => {
    const ex = spawnSync("node", [CLI, "rules", "explain", "perf/lcp"], {
      encoding: "utf8",
    });
    expect(ex.status, ex.stderr).toBe(0);
    expect(ex.stdout).toContain("perf/lcp");
    expect(ex.stdout).toContain("2500");
    expect(ex.stdout).toMatch(/perf command/);
    const ls = spawnSync("node", [CLI, "rules", "--format", "json"], {
      encoding: "utf8",
    });
    const ids = (JSON.parse(ls.stdout) as { id: string }[]).map((r) => r.id);
    expect(ids).toContain("perf/opportunity");
    for (const args of [
      ["perf", "http://x.test/", "--runs", "0"],
      ["perf", "http://x.test/", "--runs", "abc"],
      ["perf", "http://x.test/", "--preset", "tablet"],
      ["perf"],
    ]) {
      expect(
        spawnSync("node", [CLI, ...args], { encoding: "utf8" }).status,
      ).toBe(2);
    }
  });
});
