import { spawnSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type CheckOptions, runCheck } from "../../src/commands/check.js";
import { UsageError } from "../../src/errors.js";
import type { CheckResult } from "../../src/report/result.js";
import { scriptedFetcher } from "../support/fake-fetcher.js";
import {
  type Behaviors,
  serveDir,
  type TestServer,
} from "../support/server.js";

const CLI = path.resolve("dist/cli.js");
const SITES = path.resolve("tests/fixtures/sites");

/**
 * Known differences between `check <dir>` and `check <url>`. A crawler only
 * sees pages that are linked or listed in a sitemap, so a page that exists as
 * a file but is reachable from nowhere is in the directory report only.
 * `pages` lists such page keys (subtracted from summary.pages); `findings`
 * lists the findings only one mode has, as "- ruleId severity url" (directory
 * only) or "+ ruleId severity url" (URL only). Every entry must still occur,
 * so the list cannot go stale.
 */
const PARITY_EXCEPTIONS: {
  fixtures: string[];
  pages: string[];
  findings: string[];
  why: string;
}[] = [
  {
    fixtures: [
      "good",
      "prelaunch",
      "broken-a",
      "broken-b",
      "broken-c",
      "astro-like",
    ],
    pages: ["/kiitos/"],
    findings: [],
    why: "the thank-you page is reached only by submitting the contact form; nothing links to it and it is not in the sitemap (noindex), so a crawler cannot find it",
  },
  {
    fixtures: ["broken-a"],
    pages: ["/tietosuojaseloste/"],
    findings: [
      "- content/word-count info /tietosuojaseloste/",
      "- crawl/orphan warning /tietosuojaseloste/",
      "- links/dead-end info /tietosuojaseloste/",
      "- targets/missing-target info /tietosuojaseloste/",
    ],
    why: "broken-a makes this page an orphan on purpose (no links, no sitemap); a crawl cannot reach it, so its page findings exist only in directory mode",
  },
];

let servers: TestServer[] = [];
let tmps: string[] = [];

afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  await Promise.all(tmps.map((d) => rm(d, { recursive: true, force: true })));
  servers = [];
  tmps = [];
});

/** Copy of a fixture project (config + dist) in a temp dir. */
async function copyFixture(name: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), `mielikki-url-${name}-`));
  tmps.push(dir);
  await cp(path.join(SITES, name), dir, { recursive: true });
  return dir;
}

async function serve(dir: string, b: Behaviors = {}): Promise<TestServer> {
  const s = await serveDir(dir, { slash: "redirect", ...b });
  servers.push(s);
  return s;
}

const OPTS: CheckOptions = {
  profile: "dev",
  format: "json",
  failOn: "error",
  minSeverity: "info",
};

async function check(
  target: string | undefined,
  cwd: string,
  extra: Partial<CheckOptions> = {},
  fetcher?: Parameters<typeof runCheck>[2]["fetcher"],
): Promise<{ code: number; out: string; warnings: string[] }> {
  let out = "";
  const warnings: string[] = [];
  const code = await runCheck(
    target,
    { ...OPTS, ...extra },
    {
      cwd,
      isTTY: false,
      write: (s) => {
        out += s;
      },
      warn: (s) => {
        warnings.push(s);
      },
      fetcher,
    },
  );
  return { code, out, warnings };
}

const findingSet = (r: CheckResult): string[] =>
  r.findings
    .filter((f) => !f.ruleId.startsWith("http/"))
    .filter((f) => f.ruleId !== "links/redirected")
    .map((f) => `${f.ruleId} ${f.severity} ${f.url ?? ""}`)
    .sort();

describe("check <url>: parity with check <dir>", () => {
  it.each([
    "good",
    "prelaunch",
    "broken-a",
    "broken-b",
    "broken-c",
    "astro-like",
  ])("%s gives the same findings", async (name) => {
    const dir = await copyFixture(name);
    const s = await serve(path.join(dir, "dist"));
    for (const profile of ["dev", "launch"] as const) {
      const d = JSON.parse((await check(undefined, dir, { profile })).out);
      const u = JSON.parse(
        (await check(`${s.url}/`, dir, { profile })).out,
      ) as CheckResult;
      expect(u.input).toEqual({ kind: "url", root: `${s.url}/` });
      const exc = PARITY_EXCEPTIONS.filter((e) => e.fixtures.includes(name));
      const unreachable = exc.flatMap((e) => e.pages);
      expect(u.summary.pages, `${name} pages`).toBe(
        d.summary.pages - unreachable.length,
      );
      const dirSet = new Set(findingSet(d));
      const urlSet = new Set(findingSet(u));
      const diff = [
        ...[...urlSet].filter((f) => !dirSet.has(f)).map((f) => `+ ${f}`),
        ...[...dirSet].filter((f) => !urlSet.has(f)).map((f) => `- ${f}`),
      ].sort();
      expect(diff, `${name} (${profile})`).toEqual(
        exc.flatMap((e) => e.findings).sort(),
      );
    }
  });
});

describe("check <url>: crawl behaviour", () => {
  it("a page slower than --timeout does not abort the crawl", async () => {
    const dir = await copyFixture("good");
    const s = await serve(path.join(dir, "dist"), {
      delayMs: { "/yhteystiedot/": 3000 },
    });
    const r = await check(`${s.url}/`, dir, { timeout: 300 });
    expect([0, 1]).toContain(r.code);
    const j = JSON.parse(r.out) as CheckResult;
    // 6 crawlable pages (see PARITY_EXCEPTIONS) minus the one that timed out
    expect(j.summary.pages).toBe(5);
  });

  it("--format json is byte-identical across two runs", async () => {
    const dir = await copyFixture("astro-like");
    const s = await serve(path.join(dir, "dist"));
    const a = await check(`${s.url}/`, dir);
    const b = await check(`${s.url}/`, dir);
    expect(a.out).toBe(b.out);
    // response headers (date, etc.) are never part of a report
    expect(a.out).not.toMatch(/"date"|"headers"|content-length/i);
  });

  it("report root is the start URL without query and hash", async () => {
    const dir = await copyFixture("good");
    const s = await serve(path.join(dir, "dist"));
    const r = await check(`${s.url}/?a=1#top`, dir);
    expect((JSON.parse(r.out) as CheckResult).input).toEqual({
      kind: "url",
      root: `${s.url}/`,
    });
  });

  it("a start URL that is an asset path is a usage error", async () => {
    const dir = await copyFixture("good");
    const s = await serve(path.join(dir, "dist"));
    const p = check(`${s.url}/robots.txt`, dir);
    await expect(p).rejects.toThrow(UsageError);
    await expect(p).rejects.toThrow(/must be a page, not an asset/);
  });

  it("a start URL answering 404 is not reachable", async () => {
    const dir = await copyFixture("good");
    const s = await serve(path.join(dir, "dist"));
    await expect(check(`${s.url}/ei-ole/`, dir)).rejects.toThrow(
      /Start URL is not reachable: .*\(HTTP 404\)/,
    );
  });

  it("warns when the host is neither local nor config.site", async () => {
    const dir = await copyFixture("good");
    const fake = scriptedFetcher({
      "https://other.example/": {
        html: '<html lang="fi"><head><title>x</title></head><body><h1>x</h1></body></html>',
      },
    });
    const r = await check("https://other.example/", dir, {}, () => fake);
    expect(r.warnings.join("\n")).toMatch(/not config\.site/);
    expect(r.out).not.toMatch(/warning: checking/);

    const own = scriptedFetcher({
      "https://sahko.example/": {
        html: '<html lang="fi"><head><title>x</title></head><body><h1>x</h1></body></html>',
      },
    });
    const r2 = await check("https://sahko.example/", dir, {}, () => own);
    expect(r2.warnings.join("\n")).not.toMatch(/not config\.site/);
  });

  it("no warning for a local host", async () => {
    const dir = await copyFixture("good");
    const s = await serve(path.join(dir, "dist"));
    const r = await check(`${s.url}/`, dir);
    expect(r.warnings.join("\n")).not.toMatch(/not config\.site/);
  });
});

describe("check <url>: CLI", () => {
  const run = (args: string[], cwd: string) =>
    spawnSync("node", [CLI, ...args], { encoding: "utf8", cwd });

  it("closed port → exit 2, not reachable", async () => {
    const dir = await copyFixture("good");
    const port = await new Promise<number>((resolve) => {
      const srv = net.createServer();
      srv.listen(0, "127.0.0.1", () => {
        const p = (srv.address() as net.AddressInfo).port;
        srv.close(() => resolve(p));
      });
    });
    const r = run(["check", `http://127.0.0.1:${port}/`], dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/not reachable/);
    expect(r.stdout).toBe("");
  });

  it("credentials in the URL → exit 2", async () => {
    const dir = await copyFixture("good");
    const r = run(["check", "https://u:p@127.0.0.1/"], dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/credentials/);
  });

  it("an invalid crawl flag value → exit 2", async () => {
    const dir = await copyFixture("good");
    expect(run(["check", "--max-pages", "0"], dir).status).toBe(2);
    expect(run(["check", "--timeout", "abc"], dir).status).toBe(2);
  });

  it("crawl flags are accepted (and ignored in directory mode)", async () => {
    const dir = await copyFixture("good");
    const r = run(
      [
        "check",
        "--max-pages",
        "5",
        "--max-assets",
        "5",
        "--concurrency",
        "2",
        "--delay",
        "0",
        "--timeout",
        "5000",
        "--max-bytes",
        "100000",
        "--respect-robots",
        "--format",
        "json",
      ],
      dir,
    );
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).input.kind).toBe("dir");
  });

  it("serves a URL crawl through the CLI with --max-pages", async () => {
    const dir = await copyFixture("good");
    const s = await serve(path.join(dir, "dist"));
    // spawnSync would block the in-process server, so run async.
    const { spawn } = await import("node:child_process");
    const child = spawn(
      "node",
      [CLI, "check", `${s.url}/`, "--max-pages", "2", "--format", "json"],
      { cwd: dir },
    );
    let out = "";
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
    });
    const code = await new Promise<number | null>((resolve) =>
      child.on("close", resolve),
    );
    expect([0, 1]).toContain(code);
    expect(JSON.parse(out).summary.pages).toBe(2);
  });
});

describe("check <url>: broken is decided from what was requested", () => {
  const ids = (r: { out: string }, id: string): string[] =>
    (JSON.parse(r.out) as CheckResult).findings
      .filter((f) => f.ruleId === id)
      .map((f) => `${f.url ?? ""} ${f.message}`);

  /** Adds HTML right after <main> of the fixture's start page. */
  async function inject(dir: string, extra: string): Promise<void> {
    const { readFile, writeFile } = await import("node:fs/promises");
    const file = path.join(dir, "dist/index.html");
    const html = await readFile(file, "utf8");
    await writeFile(file, html.replace("<main>", `<main>${extra}`));
  }

  it("--max-pages 2: pages that were not crawled are not broken or missing", async () => {
    const dir = await copyFixture("good");
    const s = await serve(path.join(dir, "dist"));
    const r = await check(`${s.url}/`, dir, { maxPages: 2 });
    expect(ids(r, "links/broken-internal")).toEqual([]);
    expect(ids(r, "targets/page-missing")).toEqual([]);
    expect(ids(r, "http/crawl-limit")).toHaveLength(1);
  });

  it("--max-assets 0: images that were not requested are not broken", async () => {
    const dir = await copyFixture("good");
    const s = await serve(path.join(dir, "dist"));
    const r = await check(`${s.url}/`, dir, { maxAssets: 0 });
    expect(ids(r, "images/broken")).toEqual([]);
    expect(ids(r, "links/broken-internal")).toEqual([]);
  });

  it("an internal link that 301s (on-host or off-host) is only links/redirected; a 404 link is broken", async () => {
    const dir = await copyFixture("good");
    await inject(
      dir,
      '<p><a href="/vanha/">vanha</a> <a href="/kauppa/">kauppa</a> <a href="/ei-ole/">ei</a></p>',
    );
    const s = await serve(path.join(dir, "dist"), {
      redirects: {
        "/vanha/": { status: 301, location: "/palvelut/" },
        "/kauppa/": { status: 301, location: "https://kauppa.example/" },
      },
    });
    const r = await check(`${s.url}/`, dir);
    const broken = ids(r, "links/broken-internal");
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatch(
      /"\/ei-ole\/" points to \/ei-ole\/, which does not exist/,
    );
    const redirected = ids(r, "links/redirected").join("\n");
    expect(redirected).toContain(`${s.url}/vanha/`);
    expect(redirected).toContain(`${s.url}/kauppa/`);
  });

  it("an image that redirects to another host (CDN) is not broken; a missing image is", async () => {
    const dir = await copyFixture("good");
    await inject(
      dir,
      '<img src="/images/cdn.jpg" alt="cdn" width="1" height="1"><img src="/images/puuttuu.jpg" alt="x" width="1" height="1">',
    );
    const s = await serve(path.join(dir, "dist"), {
      redirects: {
        "/images/cdn.jpg": {
          status: 302,
          location: "https://cdn.example/cdn.jpg",
        },
      },
    });
    const r = await check(`${s.url}/`, dir);
    const broken = ids(r, "images/broken");
    expect(broken).toHaveLength(1);
    expect(broken[0]).toContain("/images/puuttuu.jpg");
  });
});

describe("check <url>: start URL redirecting to another origin", () => {
  it("another port/scheme on the same hostname is a usage error naming the final origin", async () => {
    const dir = await copyFixture("good");
    const b = await serve(path.join(dir, "dist"));
    const a = await serve(path.join(dir, "dist"), {
      redirects: { "/": { status: 301, location: `${b.url}/` } },
    });
    const p = check(`${a.url}/`, dir);
    await expect(p).rejects.toThrow(UsageError);
    await expect(p).rejects.toThrow(
      `Start URL redirects to ${b.url}; check that URL instead`,
    );
  });

  it("another hostname is a usage error naming the final origin", async () => {
    const dir = await copyFixture("good");
    const b = await serve(path.join(dir, "dist"));
    const other = b.url.replace("127.0.0.1", "localhost");
    const a = await serve(path.join(dir, "dist"), {
      redirects: { "/": { status: 301, location: `${other}/` } },
    });
    await expect(check(`${a.url}/`, dir)).rejects.toThrow(
      `Start URL redirects to ${other}; check that URL instead`,
    );
  });

  it("CLI: exit 2 with the hint", async () => {
    const dir = await copyFixture("good");
    const b = await serve(path.join(dir, "dist"));
    const a = await serve(path.join(dir, "dist"), {
      redirects: { "/": { status: 301, location: `${b.url}/` } },
    });
    const { spawn } = await import("node:child_process");
    const child = spawn("node", [CLI, "check", `${a.url}/`], { cwd: dir });
    let err = "";
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString();
    });
    const code = await new Promise<number | null>((resolve) =>
      child.on("close", resolve),
    );
    expect(code).toBe(2);
    expect(err).toContain(`Start URL redirects to ${b.url}`);
    expect(err).not.toMatch(/\n\s+at /);
  });
});
