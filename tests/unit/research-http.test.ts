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
    } else if (url === "/big") {
      res.end("x".repeat(5000));
    } else if (url === "/bigstream") {
      res.write("x".repeat(3000));
      setTimeout(() => res.end("x".repeat(3000)), 10);
    } else if (url === "/slow") {
      setTimeout(() => res.end("late"), 1500);
    } else if (url === "/postredir") {
      res.writeHead(302, { location: "/echo" }).end();
    } else if (url === "/echo") {
      let b = "";
      req.on("data", (d) => {
        b += d;
      });
      req.on("end", () =>
        res.end(`${req.method}|${req.headers["content-type"] ?? ""}|${b}`),
      );
    } else if (url === "/downgrade") {
      const port = (server.address() as AddressInfo).port;
      res.writeHead(302, { location: `https://127.0.0.1:${port}/ok` }).end();
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
  it("rejects responses over the size cap", async () => {
    const small = createHttpJson({
      userAgent: "T/1",
      timeoutMs: 2000,
      maxBytes: 4000,
    });
    await expect(small.getText(`${base}/big`)).rejects.toThrow(
      "network: response too large",
    );
    await expect(small.getText(`${base}/bigstream`)).rejects.toThrow(
      "network: response too large",
    );
  });
  it("times out", async () => {
    const fast = createHttpJson({ userAgent: "T/1", timeoutMs: 200 });
    await expect(fast.getText(`${base}/slow`)).rejects.toThrow(
      "network: timeout",
    );
  });
  it("turns POST into GET without body on 302", async () => {
    const r = await http.postJson(`${base}/postredir`, { a: 1 });
    expect(r.text).toBe("GET||");
  });
  it("refuses a scheme change on the same host", async () => {
    await expect(http.getText(`${base}/downgrade`)).rejects.toThrow(
      "network: redirect to another host",
    );
  });
  it("never leaks header values into errors", async () => {
    const secret = "Bearer s3cr3t\nTOKENä";
    const err = await http
      .getText(`${base}/ok`, { headers: { authorization: secret } })
      .then(
        () => undefined,
        (e: unknown) => e as Error,
      );
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).not.toContain("s3cr3t");
    expect(err?.message).toMatch(/^network: /);
  });
  it("rejects an invalid URL", async () => {
    await expect(http.getText("not a url")).rejects.toThrow(
      "network: invalid URL",
    );
  });
});
