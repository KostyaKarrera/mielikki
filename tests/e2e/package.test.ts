import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("package", () => {
  it("builds on install from git (prepare) and ships dist and vendor", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
      bin: Record<string, string>;
    };
    expect(pkg.scripts.prepare).toBe("npm run build");
    expect(pkg.bin.mielikki).toBe("dist/cli.js");
    // npm 10 runs `prepare` on `npm pack` even with --ignore-scripts, which
    // rewrites dist/ while other tests spawn the CLI. Pack a scratch copy of
    // the package (scripts removed) instead of the live checkout.
    const tmp = mkdtempSync(path.join(os.tmpdir(), "mielikki-pack-"));
    for (const f of ["dist", "vendor", "LICENSE", "NOTICE"])
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
    rmSync(tmp, { recursive: true, force: true });
    expect(r.status).toBe(0);
    const [info] = JSON.parse(r.stdout) as { files: { path: string }[] }[];
    const files = (info?.files ?? []).map((f) => f.path);
    expect(files).toContain("dist/cli.js");
    expect(files).toContain("vendor/schemaorg-all-https.jsonld");
    expect(
      files.some((f) => f.startsWith("src/") || f.startsWith("tests/")),
    ).toBe(false);
  });

  it("dist stays git-ignored", () => {
    const r = spawnSync("git", ["check-ignore", "dist/cli.js"], {
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
  });
});
