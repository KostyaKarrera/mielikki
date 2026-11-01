import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("package", () => {
  it("builds on install from git (prepare) and ships dist and vendor", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
      bin: Record<string, string>;
    };
    expect(pkg.scripts.prepare).toBe("npm run build");
    expect(pkg.bin.mielikki).toBe("dist/cli.js");
    // dist exists (global setup built it); --ignore-scripts avoids a rebuild here.
    const r = spawnSync(
      "npm",
      ["pack", "--dry-run", "--json", "--ignore-scripts"],
      { encoding: "utf8", shell: process.platform === "win32" },
    );
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
