import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runResearchCompetitors,
  runResearchSuggest,
  runResearchTrends,
} from "../../src/commands/research.js";
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

  it("--hl overrides config language for the alphabet", async () => {
    server = await serveDir("tests/fixtures/research", {
      suggest: (q) => ({ body: JSON.stringify([q, []]) }),
    });
    const h = harness();
    writeFileSync(
      path.join(h.io.cwd, "mielikki.config.yaml"),
      "language: fi\nregion: FI\n",
    );
    const code = await runResearchSuggest(
      ["x"],
      { ...base, expand: "alphabet", hl: "en", noCache: true },
      h.io,
      { baseUrl: server.url, sleep: async () => {} },
    );
    expect(code).toBe(0);
    expect(server.suggestLog).toHaveLength(27);
    expect(server.suggestLog.join("\n")).toContain("hl=en&gl=fi");
  });

  it("unwritable --output exits 2 with a clear message", async () => {
    server = await serveDir("tests/fixtures/research", {
      suggest: () => ({ body: fx("suggest-bare.json") }),
    });
    const h = harness();
    writeFileSync(path.join(h.io.cwd, "file"), "");
    const code = await runResearchSuggest(
      ["sähköasentaja"],
      { ...base, output: "file/out.json" },
      h.io,
      { baseUrl: server.url, sleep: async () => {} },
    );
    expect(code).toBe(2);
    expect(h.err()).toContain("cannot write file/out.json");
    expect(h.err()).not.toMatch(/\n\s+at /);
  });

  it("exit 1 lists up to 3 distinct messages", async () => {
    server = await serveDir("tests/fixtures/research", {
      suggest: (q) =>
        q === "a"
          ? { status: 500, body: "" }
          : q === "b"
            ? { status: 403, body: "" }
            : q === "c"
              ? { body: "<html>" }
              : { status: 502, body: "" },
    });
    const h = harness();
    const code = await runResearchSuggest(["a", "b", "c", "d"], base, h.io, {
      baseUrl: server.url,
      sleep: async () => {},
    });
    expect(code).toBe(1);
    const line = h.err();
    expect(line).toContain("HTTP 403");
    expect(line).toContain("HTTP 500");
    expect(line).toContain("response is not JSON");
    expect(line).not.toContain("HTTP 502");
    expect(line).toContain("4 of 4 requests failed");
  });
});

describe("research trends", () => {
  const trends = (path: string) =>
    path.endsWith("/explore")
      ? { body: fx("trends-explore.txt") }
      : { body: fx("trends-multiline.txt") };
  const topts = {
    timeframe: "today 5-y",
    geo: "FI",
    hl: "fi",
    format: "json" as const,
    noMeta: true,
    refresh: false,
    noCache: false,
  };

  it("trends_exit_codes_and_output", async () => {
    const h = harness();
    expect(await runResearchTrends([], topts, h.io)).toBe(2);
    expect(h.err()).toContain("укажите хотя бы один термин");

    server = await serveDir("tests/fixtures/research", { trends });
    const h2 = harness();
    expect(
      await runResearchTrends(["sähköasentaja", "led"], topts, h2.io, {
        baseUrl: server.url,
      }),
    ).toBe(0);
    const j = JSON.parse(h2.out());
    expect(j.kind).toBe("trends");
    expect(j.rows).toHaveLength(6);
    expect(j.summary[1].term).toBe("sähköasentaja");
    expect(j.summary[1].peakMonth).toBe(1);
    expect(j.meta).toBeUndefined();

    const h3 = harness();
    expect(
      await runResearchTrends(
        ["sähköasentaja", "led"],
        { ...topts, format: "csv" },
        h3.io,
        { baseUrl: server.url },
      ),
    ).toBe(0);
    expect(h3.out().split("\n")[0]).toBe("term,weekStart,value");
  });

  it("trends md includes summary table, csv warns", async () => {
    server = await serveDir("tests/fixtures/research", { trends });
    const h = harness();
    await runResearchTrends(
      ["sähköasentaja", "led"],
      { ...topts, format: "md" },
      h.io,
      {
        baseUrl: server.url,
      },
    );
    expect(h.out()).toContain("Summary");
    expect(h.out()).toContain("| term | average | peakMonth | seasonality |");
    const h2 = harness();
    await runResearchTrends(
      ["sähköasentaja", "led"],
      { ...topts, format: "csv" },
      h2.io,
      {
        baseUrl: server.url,
      },
    );
    expect(h2.err()).toContain("summary is only included in json/md output");
    expect(h2.out()).not.toContain("Summary");
  });

  it("trends_output_write_failure_exits_2", async () => {
    server = await serveDir("tests/fixtures/research", { trends });
    const h = harness();
    writeFileSync(path.join(tmp as string, "file"), "x");
    expect(
      await runResearchTrends(
        ["sähköasentaja", "led"],
        { ...topts, output: "file/out.json" },
        h.io,
        { baseUrl: server.url },
      ),
    ).toBe(2);
    expect(h.err()).toContain("cannot write");
  });

  it("CLI: no terms exits 2", () => {
    const r = spawnSync("node", [CLI, "research", "trends"], {
      encoding: "utf8",
    });
    expect(r.status).toBe(2);
  });
});

describe("research competitors", () => {
  const FX = "tests/fixtures/research/competitor-site";
  const copts = {
    maxPages: 30,
    delay: 0,
    format: "json" as const,
    noMeta: true,
  };

  it("competitors_no_own_site_warning: one notice line, exit 0, uniform file", async () => {
    server = await serveDir(FX);
    const h = harness();
    expect(await runResearchCompetitors([server.url], copts, h.io)).toBe(0);
    expect(h.err()).toBe(
      "research competitors: вежливый обход, robots.txt соблюдается\n",
    );
    const f = JSON.parse(h.out());
    expect(f.kind).toBe("competitors");
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0].pagesAnalyzed).toBe(6);
    expect(f.errors).toEqual([]);
    expect(f.meta).toBeUndefined();
    const again = harness();
    await runResearchCompetitors([server.url], copts, again.io);
    expect(again.out()).toBe(h.out());
  });

  it("robots Disallow: / gives exit 1 and a clear message", async () => {
    server = await serveDir(FX, {
      dynamic: (p) =>
        p === "/robots.txt"
          ? { type: "text/plain", body: "User-agent: *\nDisallow: /\n" }
          : undefined,
    });
    const h = harness();
    expect(await runResearchCompetitors([server.url], copts, h.io)).toBe(1);
    expect(h.err()).toContain("ни с одного сайта не получено страниц");
    expect(h.err()).toContain("blocked by robots.txt");
    expect(h.out()).toBe("");
  });

  it("one site fails, another works: exit 0, error kept in the row", async () => {
    server = await serveDir(FX);
    const h = harness();
    const dead = "http://127.0.0.1:1/";
    const code = await runResearchCompetitors([server.url, dead], copts, h.io);
    expect(code).toBe(0);
    const rows = JSON.parse(h.out()).rows;
    expect(rows).toHaveLength(2);
    expect(
      rows.find((r: { pagesAnalyzed: number }) => r.pagesAnalyzed === 0),
    ).toBeDefined();
  });

  it("usage errors give exit 2; unwritable --output gives exit 2", async () => {
    const a = harness();
    expect(await runResearchCompetitors([], copts, a.io)).toBe(2);
    const b = harness();
    expect(await runResearchCompetitors(["ftp://x"], copts, b.io)).toBe(2);
    server = await serveDir(FX);
    const c = harness();
    writeFileSync(path.join(c.io.cwd, "blocker"), "x");
    expect(
      await runResearchCompetitors(
        [server.url],
        { ...copts, output: "blocker/out.json" },
        c.io,
      ),
    ).toBe(2);
    expect(c.err()).toContain("cannot write blocker/out.json");
    expect(c.err()).not.toMatch(/\n\s+at /);
  });

  it("areaServed from config marks pages as area; csv has flat columns", async () => {
    server = await serveDir(FX);
    const h = harness();
    writeFileSync(
      path.join(h.io.cwd, "mielikki.config.yaml"),
      "language: fi\nbusiness:\n  type: service-area\n  schemaType: Electrician\n  name: X\n  areaServed: [Yhteystiedot]\n",
    );
    expect(await runResearchCompetitors([server.url], copts, h.io)).toBe(0);
    const pages = JSON.parse(h.out()).rows[0].pages;
    expect(
      pages.find((p: { path: string }) => p.path === "/yhteystiedot/").kind,
    ).toBe("area");
    const csv = harness();
    await runResearchCompetitors(
      [server.url],
      { ...copts, format: "csv" },
      csv.io,
    );
    expect(csv.out().split("\n")[0]).toBe(
      "site,sitemapUrls,pagesAnalyzed,stoppedBy",
    );
  });

  it("CLI: no url exits 2, bad --max-pages exits 2", () => {
    const run = (args: string[]) =>
      spawnSync("node", [CLI, "research", "competitors", ...args], {
        encoding: "utf8",
        cwd: os.tmpdir(),
      });
    expect(run([]).status).toBe(2);
    expect(run(["http://x.test", "--max-pages", "0"]).status).toBe(2);
  });
});
