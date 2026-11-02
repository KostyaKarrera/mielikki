import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFetcher, type FetcherOptions } from "../../src/net/fetch.js";
import { createLimiter } from "../../src/net/limiter.js";
import {
  type Behaviors,
  serveDir,
  type TestServer,
} from "../support/server.js";

let dir: string;
let server: TestServer | undefined;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "mielikki-net-"));
  await writeFile(
    path.join(dir, "index.html"),
    "<html><body>Hello</body></html>",
  );
  await mkdir(path.join(dir, "a"));
  await writeFile(path.join(dir, "a", "index.html"), "<p>A</p>");
  await writeFile(path.join(dir, "big.html"), "x".repeat(5000));
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(dir, { recursive: true, force: true });
});

async function start(b: Behaviors = {}): Promise<TestServer> {
  server = await serveDir(dir, b);
  return server;
}

function fetcher(o: Partial<FetcherOptions> = {}) {
  return createFetcher({
    userAgent: "mielikki-test",
    timeoutMs: 2000,
    maxBytes: 1_000_000,
    maxHops: 10,
    concurrency: 4,
    delayMs: 0,
    allowRedirectHost: (h) => h === "127.0.0.1",
    ...o,
  });
}

describe("fetcher", () => {
  it("returns 200 with body and lowercase headers", async () => {
    const s = await start({ headers: { "/": { "X-Custom": "Yes" } } });
    const r = await fetcher().get(`${s.url}/`);
    expect(r.stop).toBeUndefined();
    expect(r.hops).toEqual([]);
    expect(r.final?.status).toBe(200);
    expect(r.final?.body).toContain("Hello");
    expect(r.final?.headers["x-custom"]).toBe("Yes");
    expect(r.final?.contentType).toContain("text/html");
    expect(r.final?.bytes).toBe(
      Buffer.byteLength("<html><body>Hello</body></html>"),
    );
  });

  it("decodes gzip bodies", async () => {
    const s = await start({ gzip: true });
    const r = await fetcher().get(`${s.url}/`);
    expect(r.final?.body).toContain("Hello");
  });

  it("follows 301 -> 302 -> 200", async () => {
    const s = await start({
      redirects: {
        "/r1": { status: 301, location: "/r2" },
        "/r2": { status: 302, location: "/a/" },
      },
    });
    const r = await fetcher().get(`${s.url}/r1`);
    expect(r.hops).toHaveLength(2);
    expect(r.hops[0]?.status).toBe(301);
    expect(r.final?.status).toBe(200);
    expect(r.final?.body).toContain("A");
  });

  it("follow:false returns the 3xx as-is", async () => {
    const s = await start({ slash: "redirect" });
    const r = await fetcher().get(`${s.url}/a`, { follow: false });
    expect(r.hops).toEqual([]);
    expect(r.final?.status).toBe(301);
    expect(r.final?.headers.location).toBe("/a/");
  });

  it("detects redirect loops", async () => {
    const s = await start({
      redirects: {
        "/A": { status: 302, location: "/B" },
        "/B": { status: 302, location: "/A" },
      },
    });
    const r = await fetcher().get(`${s.url}/A`);
    expect(r.stop).toBe("redirect-loop");
    expect(r.final).toBeUndefined();
  });

  it("stops after too many redirects", async () => {
    const redirects: Behaviors["redirects"] = {};
    for (let i = 0; i < 12; i++)
      redirects[`/h${i}`] = { status: 302, location: `/h${i + 1}` };
    const s = await start({ redirects });
    const r = await fetcher().get(`${s.url}/h0`);
    expect(r.stop).toBe("too-many-redirects");
  });

  it("does not contact a literal metadata-IP redirect target", async () => {
    const target = "http://169.254.169.254/latest/";
    const s = await start({
      redirects: { "/out": { status: 302, location: target } },
    });
    const r = await fetcher().get(`${s.url}/out`);
    expect(r.stop).toBe("left-site");
    expect(r.final).toBeUndefined();
    expect(r.hops).toHaveLength(1);
    expect(r.hops[0]?.location).toBe(target);
  });

  it("does not contact a forbidden host (second server proves it)", async () => {
    const other = await serveDir(dir);
    try {
      const target = `http://localhost:${new URL(other.url).port}/`;
      const s = await start({
        redirects: { "/out": { status: 302, location: target } },
      });
      const r = await fetcher().get(`${s.url}/out`);
      expect(r.stop).toBe("left-site");
      expect(r.final).toBeUndefined();
      expect(r.hops).toHaveLength(1);
      expect(other.requests).toEqual([]);
    } finally {
      await other.close();
    }
  });

  it("allows exactly maxHops redirects but not maxHops+1", async () => {
    const redirects: Behaviors["redirects"] = {};
    for (let i = 0; i < 10; i++) {
      redirects[`/h${i}`] = {
        status: 302,
        location: i === 9 ? "/a/" : `/h${i + 1}`,
      };
    }
    redirects["/g0"] = { status: 302, location: "/h0" };
    const s = await start({ redirects });
    const ok = await fetcher({ maxHops: 10 }).get(`${s.url}/h0`);
    expect(ok.hops).toHaveLength(10);
    expect(ok.final?.status).toBe(200);
    const bad = await fetcher({ maxHops: 10 }).get(`${s.url}/g0`);
    expect(bad.stop).toBe("too-many-redirects");
    expect(bad.final).toBeUndefined();
  });

  it("endless body gives too-large, no final, and the connection is closed", async () => {
    const s = await start({
      extra: { "/inf": { type: "text/html", body: "", stream: "endless" } },
    });
    const t0 = Date.now();
    const r = await fetcher({ maxBytes: 100_000 }).get(`${s.url}/inf`);
    expect(r.stop).toBe("too-large");
    expect(r.final).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(1500);
    await vi.waitFor(() => expect(s.aborted).toContain("/inf"));
  });

  it("stalled body gives timeout with no final", async () => {
    const s = await start({
      extra: { "/stall": { type: "text/html", body: "", stream: "stall" } },
    });
    const r = await fetcher({ timeoutMs: 200 }).get(`${s.url}/stall`);
    expect(r.stop).toBe("timeout");
    expect(r.detail).toBe("exceeded 200 ms");
    expect(r.final).toBeUndefined();
  });

  it("connection dropped mid-body gives network with no final", async () => {
    const srv = net.createServer((sock) => {
      sock.on("error", () => {});
      sock.once("data", () => {
        sock.write(
          "HTTP/1.1 200 OK\r\ncontent-type: text/html\r\ncontent-length: 1000\r\n\r\n<html>",
        );
        setTimeout(() => sock.destroy(), 20);
      });
    });
    await new Promise<void>((res) => srv.listen(0, "127.0.0.1", res));
    try {
      const port = (srv.address() as net.AddressInfo).port;
      const r = await fetcher().get(`http://127.0.0.1:${port}/`);
      expect(r.stop).toBe("network");
      expect(r.final).toBeUndefined();
    } finally {
      await new Promise<void>((res) => srv.close(() => res()));
    }
  });

  it("returns too-large when body exceeds maxBytes", async () => {
    const s = await start();
    const r = await fetcher({ maxBytes: 1000 }).get(`${s.url}/big.html`);
    expect(r.stop).toBe("too-large");
    expect(r.final).toBeUndefined();
  });

  it("times out on a slow server", async () => {
    const s = await start({ delayMs: { "/": 1500 } });
    const r = await fetcher({ timeoutMs: 100 }).get(`${s.url}/`);
    expect(r.stop).toBe("timeout");
    expect(r.detail).toBe("exceeded 100 ms");
  });

  it("reports network errors for a closed port", async () => {
    const port = await new Promise<number>((resolve) => {
      const srv = net.createServer();
      srv.listen(0, "127.0.0.1", () => {
        const p = (srv.address() as net.AddressInfo).port;
        srv.close(() => resolve(p));
      });
    });
    const r = await fetcher().get(`http://127.0.0.1:${port}/`);
    expect(r.stop).toBe("network");
    expect(r.detail).toBeTruthy();
  });

  it("HEAD does not read a body", async () => {
    const s = await start();
    const r = await fetcher().get(`${s.url}/`, { method: "HEAD" });
    expect(r.final?.status).toBe(200);
    expect(r.final?.body).toBeUndefined();
    expect(r.final?.bytes).toBe(
      Buffer.byteLength("<html><body>Hello</body></html>"),
    );
  });

  it("skips the body when wantBody is false or the type is binary", async () => {
    const s = await start({
      extra: { "/bin": { type: "image/png", body: Buffer.from([1, 2, 3]) } },
    });
    const f = fetcher();
    expect(
      (await f.get(`${s.url}/`, { wantBody: false })).final?.body,
    ).toBeUndefined();
    const bin = await f.get(`${s.url}/bin`);
    expect(bin.final?.body).toBeUndefined();
    expect(bin.final?.bytes).toBe(3);
  });

  it("reads body for xml with charset parameters", async () => {
    const s = await start({
      extra: {
        "/s.xml": { type: "application/xml; charset=utf-8", body: "<a/>" },
      },
    });
    expect((await fetcher().get(`${s.url}/s.xml`)).final?.body).toBe("<a/>");
  });

  it("applies mapUrl to the request URL and Location before the host check", async () => {
    const s = await start({
      redirects: { "/m": { status: 302, location: "http://site.invalid/a/" } },
    });
    const r = await fetcher({
      mapUrl: (u) => u.replace("http://site.invalid", s.url),
    }).get("http://site.invalid/m");
    expect(r.requested).toBe("http://site.invalid/m");
    expect(r.stop).toBeUndefined();
    expect(r.final?.status).toBe(200);
    expect(r.final?.url).toBe(`${s.url}/a/`);
    expect(s.requests).toEqual(["/m", "/a/"]);
  });
});

describe("limiter", () => {
  it("runs at most `concurrency` tasks at once", async () => {
    const limit = createLimiter(2, 0);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        limit(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 20));
          active--;
        }),
      ),
    );
    expect(peak).toBe(2);
  });

  it("spaces starts by delayMs", async () => {
    const limit = createLimiter(3, 50);
    const starts: number[] = [];
    await Promise.all(
      Array.from({ length: 4 }, () =>
        limit(async () => {
          starts.push(Date.now());
        }),
      ),
    );
    for (let i = 1; i < starts.length; i++) {
      expect(
        (starts[i] as number) - (starts[i - 1] as number),
      ).toBeGreaterThanOrEqual(48);
    }
  });
});
