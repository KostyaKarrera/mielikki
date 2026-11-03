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

const crawl = (url: string) =>
  new Promise<{ status: number | null; report: Report; stderr: string }>(
    (resolve) => {
      const child = spawn(
        "node",
        [CLI, "check", url, "--format", "json", "--max-pages", "10"],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let out = "";
      let err = "";
      child.stdout.on("data", (d: Buffer) => {
        out += d;
      });
      child.stderr.on("data", (d: Buffer) => {
        err += d;
      });
      child.on("close", (status) =>
        resolve({ status, report: JSON.parse(out) as Report, stderr: err }),
      );
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
    expect(
      r.report.findings.filter((f) => f.ruleId === "crawl/page-unparseable"),
    ).toHaveLength(1);
  }, 60_000);
});
