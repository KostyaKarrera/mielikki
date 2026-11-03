import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseConfig } from "../../../../src/config/schema.js";
import { loadUrl } from "../../../../src/load/url.js";
import { createFetcher } from "../../../../src/net/fetch.js";
import { serveDir, type TestServer } from "../../../support/server.js";
import { OPTS } from "./_util.js";

let server: TestServer | undefined;
let dir: string | undefined;
afterEach(async () => {
  await server?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
  server = undefined;
  dir = undefined;
});

describe("content-encoding through the real fetcher", () => {
  it("loadUrl keeps content-encoding on Page.headers", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "mielikki-gz-"));
    await writeFile(
      path.join(dir, "index.html"),
      `<html lang="fi"><body><main><h1>x</h1><p>${"y".repeat(3000)}</p></main></body></html>`,
    );
    server = await serveDir(dir, { gzip: true });
    const fetcher = createFetcher({
      userAgent: "mielikki-test",
      timeoutMs: 2000,
      maxBytes: 1_000_000,
      maxHops: 10,
      concurrency: 4,
      delayMs: 0,
      allowRedirectHost: (h) => h === "127.0.0.1",
    });
    const site = await loadUrl(
      `${server.url}/`,
      parseConfig({}),
      fetcher,
      OPTS,
    );
    const p = site.pages[0];
    expect(p?.headers?.["content-encoding"]).toBe("gzip");
    expect(p?.html).toContain("yyy");
  });
});
