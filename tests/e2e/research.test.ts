import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runResearchSuggest } from "../../src/commands/research.js";
import { serveDir, type TestServer } from "../support/server.js";

const CLI = path.resolve("dist/cli.js");
const fx = (n: string): string =>
  readFileSync(`tests/fixtures/research/${n}`, "utf8");

let server: TestServer | undefined;
let tmp: string | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

function harness() {
  let out = "";
  let err = "";
  tmp = mkdtempSync(path.join(os.tmpdir(), "mielikki-research-"));
  return {
    io: {
      cwd: tmp,
      write: (s: string) => {
        out += s;
      },
      warn: (s: string) => {
        err += `${s}\n`;
      },
    },
    out: () => out,
    err: () => err,
  };
}

const base = {
  fromConfig: false,
  expand: "none" as const,
  delay: 0,
  format: "json" as const,
  noMeta: true,
  refresh: false,
  noCache: false,
};

describe("research suggest", () => {
  it("suggest_exit_codes", async () => {
    const h = harness();
    expect(await runResearchSuggest([], base, h.io)).toBe(2);
    expect(h.err()).toContain("укажите основы или --from-config");

    server = await serveDir("tests/fixtures/research", {
      suggest: (q) =>
        q === "bad"
          ? { status: 503, body: "no" }
          : { body: fx("suggest-bare.json") },
    });
    const deps = { baseUrl: server.url, sleep: async () => {} };
    const ok = harness();
    expect(await runResearchSuggest(["sähköasentaja"], base, ok.io, deps)).toBe(
      0,
    );
    expect(JSON.parse(ok.out()).rows).toHaveLength(3);

    const part = harness();
    expect(
      await runResearchSuggest(["sähköasentaja", "bad"], base, part.io, deps),
    ).toBe(0);
    expect(JSON.parse(part.out()).errors).toHaveLength(1);

    const all = harness();
    expect(await runResearchSuggest(["bad"], base, all.io, deps)).toBe(1);
    expect(all.err()).toContain("Google Suggest unavailable:");
    expect(all.err()).not.toMatch(/\n\s+at /);
    expect(all.out()).toBe("");
  });

  it("garbage everywhere gives exit 1 with a clean message", async () => {
    server = await serveDir("tests/fixtures/research", {
      suggest: () => ({ body: fx("suggest-garbage.txt"), type: "text/html" }),
    });
    const h = harness();
    const code = await runResearchSuggest(["x"], base, h.io, {
      baseUrl: server.url,
      sleep: async () => {},
    });
    expect(code).toBe(1);
    expect(h.err()).toContain("Google Suggest unavailable:");
  });

  it("suggest_deterministic", async () => {
    let n = 0;
    server = await serveDir("tests/fixtures/research", {
      suggest: (q) => ({
        body:
          q === "sähköasentaja a"
            ? fx("suggest-a.json")
            : fx("suggest-bare.json"),
        delayMs: (n++ * 7) % 13,
      }),
    });
    const deps = { baseUrl: server.url, sleep: async () => {} };
    const run = async (): Promise<string> => {
      const h = harness();
      await runResearchSuggest(
        ["sähköasentaja"],
        { ...base, expand: "alphabet", noCache: true },
        h.io,
        deps,
      );
      return h.out();
    };
    const a = await run();
    const b = await run();
    expect(a).toBe(b);
    expect(a).not.toContain("generatedAt");
  });

  it("--from-config uses primary and secondary, --output writes a file, cache lands in .mielikki/cache", async () => {
    server = await serveDir("tests/fixtures/research", {
      suggest: (q) => ({ body: JSON.stringify([q, [`${q} hinta`]]) }),
    });
    const h = harness();
    writeFileSync(
      path.join(h.io.cwd, "mielikki.config.yaml"),
      `language: fi
region: FI
targets:
  pages:
    - url: /
      primary: sähköasentaja
      secondary: [sähkötyöt]
`,
    );
    const code = await runResearchSuggest(
      [],
      { ...base, fromConfig: true, output: "out.csv", format: "csv" },
      h.io,
      { baseUrl: server.url, sleep: async () => {} },
    );
    expect(code).toBe(0);
    const csv = readFileSync(path.join(h.io.cwd, "out.csv"), "utf8");
    expect(csv).toContain("sähköasentaja hinta");
    expect(csv).toContain("sähkötyöt hinta");
    expect(h.out()).toBe("");
    const log = server.suggestLog.join("\n");
    expect(log).toContain("hl=fi&gl=fi");
    expect(
      readFileSync(
        path.join(
          h.io.cwd,
          ".mielikki/cache",
          (await import("node:fs")).readdirSync(
            path.join(h.io.cwd, ".mielikki/cache"),
          )[0] as string,
        ),
        "utf8",
      ),
    ).toContain("hinta");
  });

  it("CLI: no seeds exits 2, bad --expand exits 2", () => {
    const run = (args: string[]) =>
      spawnSync("node", [CLI, "research", "suggest", ...args], {
        encoding: "utf8",
        cwd: os.tmpdir(),
      });
    const a = run([]);
    expect(a.status).toBe(2);
    expect(a.stderr).toContain("укажите основы или --from-config");
    expect(run(["x", "--expand", "nope"]).status).toBe(2);
    expect(run(["x", "--delay", "-1"]).status).toBe(2);
  });
});
