import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCheck } from "../../src/commands/check.js";
import { runInit } from "../../src/commands/init.js";
import { listRules } from "../../src/commands/rules.js";
import { tokenPath } from "../../src/gsc/paths.js";

const CLI = path.resolve("dist/cli.js");
const run = (args: string[], env: NodeJS.ProcessEnv = {}) =>
  spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

describe("cli help", () => {
  it("lists all top-level commands", () => {
    const r = run(["--help"]);
    expect(r.status).toBe(0);
    for (const c of ["check", "perf", "rules", "init", "research", "gsc"])
      expect(r.stdout).toMatch(new RegExp(`^\\s+${c}\\b`, "m"));
  });
  it("lists research subcommands", () => {
    const r = run(["research", "--help"]);
    expect(r.status).toBe(0);
    for (const c of ["suggest", "trends", "competitors"])
      expect(r.stdout).toMatch(new RegExp(`^\\s+${c}\\b`, "m"));
  });
  it("lists gsc subcommands", () => {
    const r = run(["gsc", "--help"]);
    expect(r.status).toBe(0);
    for (const c of ["auth", "inspect", "queries"])
      expect(r.stdout).toMatch(new RegExp(`^\\s+${c}\\b`, "m"));
  });
});

describe("cli usage errors (built binary)", () => {
  let tmp: string | undefined;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it("research suggest without seeds exits 2 with a hint", () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "mielikki-help-"));
    const r = spawnSync("node", [CLI, "research", "suggest"], {
      encoding: "utf8",
      cwd: tmp,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--from-config");
  });

  it("gsc auth without flags and without a token exits 2 with a hint", () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "mielikki-help-"));
    const r = run(["gsc", "auth"], {
      XDG_CONFIG_HOME: path.join(tmp, "cfg"),
      HOME: tmp,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("gsc auth --client");
    expect(r.stderr).toContain("--adc");
  });
});

describe("no network for check and rules", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("makes no network call even with a cache and a stored token present", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "mielikki-nonet-"));
    try {
      const dist = path.join(tmp, "dist");
      mkdirSync(dist);
      writeFileSync(
        path.join(dist, "index.html"),
        '<!doctype html><html lang="fi"><head><title>Testi</title></head><body><h1>Testi</h1></body></html>',
      );
      mkdirSync(path.join(tmp, ".mielikki", "cache"), { recursive: true });
      writeFileSync(
        path.join(tmp, ".mielikki", "cache", "x.json"),
        JSON.stringify({ at: Date.now(), value: "[]" }),
      );
      vi.stubEnv("XDG_CONFIG_HOME", path.join(tmp, "cfg"));
      vi.stubEnv("HOME", tmp);
      const tokenFile = tokenPath(process.env, os.homedir());
      expect(tokenFile).toBe(
        path.join(tmp, "cfg", "mielikki", "gsc-token.json"),
      );
      mkdirSync(path.dirname(tokenFile), { recursive: true });
      writeFileSync(
        tokenFile,
        JSON.stringify({ source: "adc", refreshToken: "r" }),
        { mode: 0o600 },
      );
      const fetchStub = vi.fn(() => {
        throw new Error("network call attempted");
      });
      vi.stubGlobal("fetch", fetchStub);
      expect(existsSync(tokenFile)).toBe(true);
      const connect = vi
        .spyOn(net.Socket.prototype, "connect")
        .mockImplementation(() => {
          throw new Error("socket opened");
        });
      let out = "";
      const code = await runCheck(
        "dist",
        {
          profile: "dev",
          format: "json",
          failOn: "error",
          minSeverity: "info",
        },
        {
          cwd: tmp,
          write: (s: string) => {
            out += s;
          },
          isTTY: false,
          warn: () => {},
        },
      );
      expect([0, 1]).toContain(code);
      expect(out).toContain("schemaVersion");
      expect(listRules("text")).toContain("core/");
      const initCode = await runInit(
        "dist",
        { force: true },
        { cwd: tmp, write: () => {}, warn: () => {} },
      );
      expect(initCode).toBe(0);
      expect(fetchStub).not.toHaveBeenCalled();
      expect(connect).not.toHaveBeenCalled();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
