import { spawn } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { serveDir, type TestServer } from "../support/server.js";

const CLI = path.resolve("dist/cli.js");
const page = (body: string): string =>
  `<!doctype html><html lang="fi"><head><meta charset="utf-8"><title>T</title></head><body><main>${body}</main></body></html>`;

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

interface Report {
  findings: { ruleId: string; severity: string; url?: string }[];
}

const KILL_AFTER_MS = 45_000;

/** Runs the CLI; a hang becomes an error naming the elapsed time and captured output. */
const crawl = (url: string) =>
  new Promise<{ status: number | null; report: Report; stderr: string }>(
    (resolve, reject) => {
      const started = Date.now();
      const child = spawn(
        "node",
        [CLI, "check", url, "--format", "json", "--max-pages", "10"],
        {
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, MIELIKKI_DEBUG_PARSE: "1" },
        },
      );
      let out = "";
      let err = "";
      child.stdout.on("data", (d: Buffer) => {
        out += d;
      });
      child.stderr.on("data", (d: Buffer) => {
        err += d;
      });
      const describeRun = (what: string): Error =>
        new Error(
          `${what} after ${Date.now() - started} ms\nstdout (${out.length} bytes): ${out.slice(0, 500)}\nstderr:\n${err.slice(-4000)}`,
        );
      const killer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(describeRun(`CLI hung, killed (${KILL_AFTER_MS} ms limit)`));
      }, KILL_AFTER_MS);
      child.on("close", (status) => {
        clearTimeout(killer);
        try {
          resolve({ status, report: JSON.parse(out) as Report, stderr: err });
        } catch {
          reject(describeRun(`CLI exited with status ${status} and no JSON`));
        }
      });
    },
  );

describe("hostile pages in url mode", () => {
  it("a too deeply nested page is a finding, the rest of the crawl proceeds, exit 1 not 2", async () => {
    server = await serveDir("tests/fixtures/sites/good", {
      dynamic: (p) =>
        p === "/hostile/"
          ? { body: page("<div></x>".repeat(60_000)) }
          : p === "/"
            ? {
                body: page(
                  '<h1>Koti</h1><a href="/hostile/">h</a><a href="/ok/">ok</a>',
                ),
              }
            : p === "/ok/"
              ? { body: page("<h1>OK</h1><p>Normaali sivu.</p>") }
              : undefined,
    });
    const r = await crawl(server.url);
    expect(r.status).toBe(1);
    expect(r.stderr).not.toMatch(/Internal error/);
    // the CLI came back promptly (the debug trace is on stderr)
    expect(
      r.report.findings.filter((f) => f.ruleId === "crawl/page-too-deep"),
    ).toHaveLength(1);
  }, 60_000);

  it("a page that cannot be parsed within limits is crawl/page-unparseable (exit 1)", async () => {
    const b = Array.from({ length: 1400 }, (_, i) => `<b a${i}>`).join("");
    server = await serveDir("tests/fixtures/sites/good", {
      dynamic: (p) =>
        p === "/hostile/"
          ? { body: `<div>${b}${"</div><div>x".repeat(3000)}` }
          : p === "/"
            ? {
                body: page(
                  '<h1>Koti</h1><a href="/hostile/">h</a><a href="/ok/">ok</a>',
                ),
              }
            : p === "/ok/"
              ? { body: page("<h1>OK</h1><p>Normaali sivu.</p>") }
              : undefined,
    });
    const r = await crawl(server.url);
    expect(r.status).toBe(1);
    expect(r.stderr).not.toMatch(/Internal error/);
    // the CLI came back promptly (the debug trace is on stderr)
    expect(
      r.report.findings.filter((f) => f.ruleId === "crawl/page-unparseable"),
    ).toHaveLength(1);
  }, 60_000);
});
