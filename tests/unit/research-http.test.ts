import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHttpJson } from "../../src/research/http.js";

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? "";
    if (url === "/ok") {
      res.end(`ua=${req.headers["user-agent"]}`);
    } else if (url === "/r1") {
      res.writeHead(302, { location: "/ok" }).end();
    } else if (url === "/loop") {
      res.writeHead(302, { location: "/loop" }).end();
    } else if (url === "/away") {
      res.writeHead(302, { location: "http://127.0.0.1:1/x" }).end();
    } else if (url === "/post") {
      let b = "";
      req.on("data", (d) => {
        b += d;
      });
      req.on("end", () => res.end(b));
    } else {
      res.writeHead(429).end("slow down");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
});

const http = createHttpJson({ userAgent: "T/1", timeoutMs: 2000 });

describe("createHttpJson", () => {
  it("gets text with user agent", async () => {
    const r = await http.getText(`${base}/ok`);
    expect(r.status).toBe(200);
    expect(r.text).toBe("ua=T/1");
  });
  it("follows same-host redirects", async () => {
    expect((await http.getText(`${base}/r1`)).text).toBe("ua=T/1");
  });
  it("returns non-2xx as a result", async () => {
    const r = await http.getText(`${base}/nope`);
    expect(r.status).toBe(429);
  });
  it("stops redirect loops and cross-host redirects", async () => {
    await expect(http.getText(`${base}/loop`)).rejects.toThrow(/^network:/);
    await expect(http.getText(`${base}/away`)).rejects.toThrow(/^network:/);
  });
  it("posts json", async () => {
    const r = await http.postJson(`${base}/post`, { a: 1 });
    expect(r.text).toBe('{"a":1}');
  });
  it("throws network error on transport failure", async () => {
    await expect(http.getText("http://127.0.0.1:1/")).rejects.toThrow(
      /^network:/,
    );
  });
});
