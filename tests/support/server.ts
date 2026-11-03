import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { gzipSync } from "node:zlib";

export interface Behaviors {
  slash?: "redirect" | "serve";
  redirects?: Record<string, { status: number; location: string }>;
  headers?: Record<string, Record<string, string>>;
  status?: Record<string, number>;
  delayMs?: Record<string, number>;
  gzip?: boolean;
  extra?: Record<
    string,
    { type: string; body: string | Buffer; stream?: "endless" | "stall" }
  >;
}

export interface TestServer {
  url: string;
  close(): Promise<void>;
  requests: string[];
  /** Paths whose response was cut off before completion (client hung up). */
  aborted: string[];
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

async function isDir(p: string): Promise<boolean> {
  return stat(p).then(
    (s) => s.isDirectory(),
    () => false,
  );
}

export async function serveDir(
  dir: string,
  b: Behaviors = {},
): Promise<TestServer> {
  const root = path.resolve(dir);
  const requests: string[] = [];
  const aborted: string[] = [];
  const timers = new Set<NodeJS.Timeout>();

  const handle = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> => {
    const pathname = new URL(req.url ?? "/", "http://x").pathname;
    requests.push(pathname);

    res.on("close", () => {
      if (!res.writableFinished) aborted.push(pathname);
    });

    const delay = b.delayMs?.[pathname];
    if (delay) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          timers.delete(t);
          resolve();
        }, delay);
        timers.add(t);
      });
    }
    if (res.destroyed) return;

    let status = b.status?.[pathname] ?? 200;
    let type = "application/octet-stream";
    let body: string | Buffer = "";
    const extraHeaders: Record<string, string> = { ...b.headers?.[pathname] };

    const redirect = b.redirects?.[pathname];
    const extra = b.extra?.[pathname];
    if (extra?.stream) {
      res.writeHead(status, { "content-type": extra.type });
      res.write("<html>");
      if (extra.stream === "endless") {
        const chunk = Buffer.alloc(16384, 120);
        const pump = (): void => {
          if (res.destroyed) return;
          if (res.write(chunk)) setImmediate(pump);
          else res.once("drain", pump);
        };
        pump();
      }
      return;
    }
    if (redirect) {
      status = redirect.status;
      extraHeaders.location = redirect.location;
    } else if (extra) {
      type = extra.type;
      body = extra.body;
    } else {
      let decoded: string;
      try {
        decoded = decodeURIComponent(pathname);
      } catch {
        decoded = pathname;
      }
      let file = path.join(root, decoded);
      if (file !== root && !file.startsWith(root + path.sep)) {
        status = 403;
      } else if (decoded.endsWith("/") || (await isDir(file))) {
        if (!decoded.endsWith("/") && b.slash === "redirect") {
          status = 301;
          extraHeaders.location = `${pathname}/`;
        } else {
          file = path.join(file, "index.html");
        }
      }
      if (status !== 301 && status !== 403) {
        try {
          body = await readFile(file);
          type = TYPES[path.extname(file)] ?? type;
        } catch {
          if (!b.status?.[pathname]) status = 404;
        }
      }
    }

    let out: string | Buffer = body;
    const headers: Record<string, string> = { ...extraHeaders };
    if (!redirect && status !== 301 && !headers["content-type"])
      headers["content-type"] = type;
    if (b.gzip && out.length > 0) {
      out = gzipSync(out);
      headers["content-encoding"] = "gzip";
    }
    headers["content-length"] = String(Buffer.byteLength(out));
    res.writeHead(status, headers);
    res.end(req.method === "HEAD" ? undefined : out);
  };

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    aborted,
    close: () =>
      new Promise<void>((resolve) => {
        for (const t of timers) clearTimeout(t);
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
