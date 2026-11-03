import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VERSION } from "../../src/version.js";

type Pkg = {
  version: string;
  scripts: Record<string, string>;
  bin: Record<string, string>;
  publishConfig?: { access?: string; provenance?: boolean };
};
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as Pkg;

describe("package", () => {
  let tmp = "";
  let files: { path: string; mode: number }[] = [];

  beforeAll(() => {
    // npm 10 runs `prepare` on `npm pack` even with --ignore-scripts, which
    // rewrites dist/ while other tests spawn the CLI. Pack a scratch copy of
    // the package (scripts removed) instead of the live checkout.
    tmp = mkdtempSync(path.join(os.tmpdir(), "mielikki-pack-"));
    for (const f of ["dist", "vendor", "LICENSE", "NOTICE", "README.md"])
      cpSync(f, path.join(tmp, f), { recursive: true });
    writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ ...pkg, scripts: {} }),
    );
    const r = spawnSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: tmp,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    expect(r.status).toBe(0);
    const [info] = JSON.parse(r.stdout) as {
      files: { path: string; mode: number }[];
    }[];
    files = info?.files ?? [];
  });

  afterAll(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("builds on install from git (prepare) and exposes the bin", () => {
    expect(pkg.scripts.prepare).toBe("npm run build");
    expect(pkg.bin.mielikki).toBe("dist/cli.js");
  });

  it("is version 1.0.0 and src/version.ts agrees", () => {
    expect(pkg.version).toBe("1.0.0");
    expect(VERSION).toBe(pkg.version);
    expect(pkg.publishConfig).toEqual({ access: "public", provenance: true });
  });

  it("ships exactly dist, vendor, LICENSE, NOTICE, README.md, package.json", () => {
    const paths = files.map((f) => f.path);
    const tops = new Set(paths.map((p) => p.split("/")[0]));
    expect([...tops].sort()).toEqual(
      [
        "LICENSE",
        "NOTICE",
        "README.md",
        "dist",
        "package.json",
        "vendor",
      ].sort(),
    );
    expect(paths).toContain("dist/cli.js");
    expect(paths).toContain("dist/parse/child.js"); // the parse subprocess entry
    expect(paths).not.toContain("dist/parse/worker.js");
    expect(paths).toContain("vendor/schemaorg-all-https.jsonld");
    expect(
      paths.some((p) => /^(src|tests|docs|\.mielikki|\.superpowers)\//.test(p)),
    ).toBe(false);
    expect(paths.filter((p) => p.endsWith(".map"))).toEqual([]);
  });

  it("bin has a shebang and is executable in the tarball", () => {
    const bin = files.find((f) => f.path === pkg.bin.mielikki);
    expect(bin).toBeDefined();
    expect(((bin?.mode ?? 0) & 0o111) !== 0).toBe(true);
    expect(
      readFileSync(path.join(tmp, pkg.bin.mielikki ?? ""), "utf8"),
    ).toMatch(/^#!\/usr\/bin\/env node\n/);
  });

  it("the packaged bin runs: --version and rules", () => {
    // Installing the tarball would need the registry for dependencies; run the
    // packaged files against the checkout's node_modules instead.
    symlinkSync(path.resolve("node_modules"), path.join(tmp, "node_modules"));
    const bin = path.join(tmp, pkg.bin.mielikki ?? "");
    const v = spawnSync("node", [bin, "--version"], { encoding: "utf8" });
    expect(v.status).toBe(0);
    expect(v.stdout.trim()).toBe("1.0.0");
    const r = spawnSync("node", [bin, "rules"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("core/title-missing");
    // pages are parsed in the packaged subprocess entry (dist/parse/child.js)
    const c = spawnSync(
      "node",
      [
        bin,
        "check",
        path.resolve("tests/fixtures/sites/good"),
        "--format",
        "json",
      ],
      { encoding: "utf8" },
    );
    expect(c.stderr).not.toMatch(/not found at|Internal error/);
    expect([0, 1]).toContain(c.status);
    expect(
      (JSON.parse(c.stdout) as { summary: { pages: number } }).summary.pages,
    ).toBeGreaterThan(0);
  });

  it("dist stays git-ignored", () => {
    const r = spawnSync("git", ["check-ignore", "dist/cli.js"], {
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
  });
});
