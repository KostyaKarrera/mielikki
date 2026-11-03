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
  /** Handler for GET /complete/search (Google Suggest stand-in). */
  suggest?: (
    q: string,
    params: URLSearchParams,
  ) => { status?: number; type?: string; body: string; delayMs?: number };
  /** Handler for GET /trends/api/explore and /trends/api/widgetdata/multiline. */
  trends?: (
    path: string,
    params: URLSearchParams,
    reqHeaders: http.IncomingHttpHeaders,
  ) => {
    status?: number;
    headers?: Record<string, string | string[]>;
    type?: string;
    body: string;
  };
  /** Handler for POST /token (fake OAuth token endpoint); gets the parsed form body. */
  oauth?: (form: URLSearchParams) => {
    status?: number;
    body: string;
  };
  /**
   * Fake Search Console API: POST /v1/urlInspection/index:inspect and
   * POST /webmasters/v3/sites/<encoded siteUrl>/searchAnalytics/query.
   * `n` is the 1-based call number per route.
   */
  gsc?: (
    route: "inspect" | "analytics",
    body: Record<string, unknown>,
    ctx: { n: number; siteUrl: string; auth: string },
  ) => { status?: number; body: string };
  /** Dynamic pages (checked first): return undefined to fall through to files. */
  dynamic?: (pathname: string) =>
    | {
        status?: number;
        type?: string;
        body: string;
        headers?: Record<string, string>;
      }
    | undefined;
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
  /** Raw request URLs (path + query) of every /complete/search call, in arrival order. */
  suggestLog: string[];
  /** Raw request URLs of every /trends/api/* call, in arrival order. */
  trendsLog: string[];
  /** Cookie header of every /trends/api/* call ("" when absent). */
  trendsCookies: string[];
  /** Parsed form body of every POST /token call, in arrival order. */
  oauthLog: URLSearchParams[];
  /** Every fake Search Console call: route, raw path, Authorization header, parsed body. */
  gscLog: {
    route: "inspect" | "analytics";
    path: string;
    auth: string;
    body: Record<string, unknown>;
  }[];
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
  const suggestLog: string[] = [];
  const trendsLog: string[] = [];
  const trendsCookies: string[] = [];
  const oauthLog: URLSearchParams[] = [];
  const gscLog: TestServer["gscLog"] = [];
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

    if (pathname === "/complete/search" && b.suggest) {
      suggestLog.push(req.url ?? "");
      const params = new URL(req.url ?? "/", "http://x").searchParams;
      const r = b.suggest(params.get("q") ?? "", params);
      if (r.delayMs) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(() => {
            timers.delete(t);
            resolve();
          }, r.delayMs);
          timers.add(t);
        });
      }
      if (res.destroyed) return;
      res.writeHead(r.status ?? 200, {
        "content-type": r.type ?? "application/json; charset=utf-8",
        "content-length": String(Buffer.byteLength(r.body)),
      });
      res.end(r.body);
      return;
    }

    if (pathname === "/token" && req.method === "POST" && b.oauth) {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      oauthLog.push(form);
      const r = b.oauth(form);
      res.writeHead(r.status ?? 200, {
        "content-type": "application/json; charset=utf-8",
        "content-length": String(Buffer.byteLength(r.body)),
      });
      res.end(r.body);
      return;
    }

    const gscRoute =
      pathname === "/v1/urlInspection/index:inspect"
        ? "inspect"
        : /^\/webmasters\/v3\/sites\/[^/]+\/searchAnalytics\/query$/.test(
              pathname,
            )
          ? "analytics"
          : undefined;
    if (gscRoute && req.method === "POST" && b.gsc) {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        // leave empty
      }
      const auth = String(req.headers.authorization ?? "");
      gscLog.push({ route: gscRoute, path: pathname, auth, body });
      const n = gscLog.filter((l) => l.route === gscRoute).length;
      const siteUrl =
        gscRoute === "inspect"
          ? String(body.siteUrl ?? "")
          : decodeURIComponent(pathname.split("/")[4] ?? "");
      const r = b.gsc(gscRoute, body, { n, siteUrl, auth });
      res.writeHead(r.status ?? 200, {
        "content-type": "application/json; charset=utf-8",
        "content-length": String(Buffer.byteLength(r.body)),
      });
      res.end(r.body);
      return;
    }

    if (
      (pathname.startsWith("/trends/api/") || pathname === "/trends/") &&
      b.trends
    ) {
      trendsLog.push(req.url ?? "");
      trendsCookies.push(req.headers.cookie ?? "");
      const params = new URL(req.url ?? "/", "http://x").searchParams;
      const r = b.trends(pathname, params, req.headers);
      res.writeHead(r.status ?? 200, {
        "content-type": r.type ?? "application/json; charset=utf-8",
        "content-length": String(Buffer.byteLength(r.body)),
        ...r.headers,
      });
      res.end(r.body);
      return;
    }

    const dyn = b.dynamic?.(pathname);
    if (dyn) {
      res.writeHead(dyn.status ?? 200, {
        "content-type": dyn.type ?? "text/html; charset=utf-8",
        "content-length": String(Buffer.byteLength(dyn.body)),
        ...dyn.headers,
      });
      res.end(dyn.body);
      return;
    }

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
    suggestLog,
    trendsLog,
    trendsCookies,
    oauthLog,
    gscLog,
    close: () =>
      new Promise<void>((resolve) => {
        for (const t of timers) clearTimeout(t);
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
