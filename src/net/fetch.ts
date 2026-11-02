import type { Fetched, FetchRecord, Hop, StopReason } from "../model/types.js";
import { createLimiter } from "./limiter.js";

export interface FetcherOptions {
  userAgent: string;
  timeoutMs: number;
  maxBytes: number;
  maxHops: number;
  concurrency: number;
  delayMs: number;
  allowRedirectHost(host: string): boolean;
  mapUrl?(url: string): string;
}

export interface GetOptions {
  method?: "GET" | "HEAD";
  follow?: boolean;
  wantBody?: boolean;
}

export interface Fetcher {
  get(url: string, o?: GetOptions): Promise<FetchRecord>;
}

const TEXT_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "text/xml",
  "application/xml",
  "text/plain",
]);

function isTextType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const media = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return TEXT_TYPES.has(media);
}

class Stop extends Error {
  constructor(
    readonly reason: StopReason,
    readonly info?: string,
  ) {
    super(info ?? reason);
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: { code?: string; message?: string } })
      .cause;
    const extra = cause?.code ?? cause?.message;
    return extra ? `${err.message}: ${extra}` : err.message;
  }
  return String(err);
}

function isTimeout(err: unknown, signal: AbortSignal): boolean {
  if (err instanceof Stop) return false;
  const name = (err as { name?: string } | null)?.name;
  return name === "TimeoutError" || (signal.aborted && name === "AbortError");
}

export function createFetcher(o: FetcherOptions): Fetcher {
  const limit = createLimiter(o.concurrency, o.delayMs);
  const map = (u: string): string => (o.mapUrl ? o.mapUrl(u) : u);

  async function readBody(
    res: Response,
  ): Promise<{ text: string; bytes: number }> {
    const reader = res.body?.getReader();
    if (!reader) return { text: "", bytes: 0 };
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > o.maxBytes) {
          throw new Stop("too-large", `body exceeds ${o.maxBytes} bytes`);
        }
        chunks.push(value);
      }
    } catch (err) {
      await reader.cancel().catch(() => {});
      throw err;
    }
    return { text: Buffer.concat(chunks).toString("utf8"), bytes: total };
  }

  async function run(
    requested: string,
    opts: GetOptions,
  ): Promise<FetchRecord> {
    const method = opts.method ?? "GET";
    const follow = opts.follow ?? true;
    const wantBody = opts.wantBody !== false && method === "GET";
    const rec: FetchRecord = { requested, hops: [] };
    const signal = AbortSignal.timeout(o.timeoutMs);
    const visited = new Set<string>();
    let current = map(requested);

    try {
      for (;;) {
        visited.add(current);
        const res = await fetch(current, {
          method,
          redirect: "manual",
          signal,
          headers: { "User-Agent": o.userAgent, "Accept-Encoding": "gzip, br" },
        });
        const headers: Record<string, string> = {};
        res.headers.forEach((v, k) => {
          headers[k.toLowerCase()] = v;
        });
        const location = headers.location;

        if (res.status >= 300 && res.status < 400 && follow && location) {
          await res.body?.cancel().catch(() => {});
          rec.hops.push({ url: current, status: res.status, location });
          let next: string;
          try {
            next = map(new URL(location, current).href);
          } catch {
            rec.stop = "network";
            rec.detail = `invalid redirect location: ${location}`;
            return rec;
          }
          if (!o.allowRedirectHost(new URL(next).hostname)) {
            rec.stop = "left-site";
            rec.detail = `redirect to ${next}`;
            return rec;
          }
          if (visited.has(next)) {
            rec.stop = "redirect-loop";
            rec.detail = `already visited ${next}`;
            return rec;
          }
          if (rec.hops.length >= o.maxHops) {
            rec.stop = "too-many-redirects";
            rec.detail = `more than ${o.maxHops} redirects`;
            return rec;
          }
          current = next;
          continue;
        }

        const contentType = headers["content-type"];
        const declared = Number.parseInt(headers["content-length"] ?? "", 10);
        const fetched: Fetched = {
          url: current,
          status: res.status,
          headers,
          bytes: Number.isFinite(declared) ? declared : 0,
        };
        if (contentType) fetched.contentType = contentType;
        rec.final = fetched;

        if (wantBody && isTextType(contentType)) {
          const { text, bytes } = await readBody(res);
          fetched.body = text;
          fetched.bytes = bytes;
        } else {
          await res.body?.cancel().catch(() => {});
        }
        return rec;
      }
    } catch (err) {
      if (err instanceof Stop) {
        rec.stop = err.reason;
        rec.detail = err.info ?? err.reason;
      } else if (isTimeout(err, signal)) {
        rec.stop = "timeout";
        rec.detail = `no response within ${o.timeoutMs} ms`;
      } else {
        rec.stop = "network";
        rec.detail = describe(err);
      }
      return rec;
    }
  }

  return {
    get(url, opts = {}) {
      return limit(() => run(url, opts)).catch(
        (err): FetchRecord => ({
          requested: url,
          hops: [] as Hop[],
          stop: "network",
          detail: describe(err),
        }),
      );
    },
  };
}
