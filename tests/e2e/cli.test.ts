import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CLI = "dist/cli.js";
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
};

describe("cli", () => {
  it("prints version and exits 0", () => {
    const r = spawnSync("node", [CLI, "--version"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(pkg.version);
  });

  it("exits 2 on unknown command", () => {
    const r = spawnSync("node", [CLI, "nope"], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unknown command");
  });
});
