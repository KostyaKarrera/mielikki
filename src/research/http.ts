export interface HttpJson {
  getText(
    url: string,
    o?: { headers?: Record<string, string> },
  ): Promise<{ status: number; headers: Record<string, string>; text: string }>;
  postJson(
    url: string,
    body: unknown,
    o?: { headers?: Record<string, string> },
  ): Promise<{ status: number; text: string }>;
}

const MAX_HOPS = 3;
const MAX_BYTES = 5_000_000;

// Fixed vocabulary only: error messages may echo header values (tokens).
function reason(err: unknown): string {
  const e = err as { name?: string; cause?: { code?: unknown } };
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "timeout";
  const code = e?.cause?.code;
  if (typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code)) return code;
  return "request failed";
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new Error("network: response too large");
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error("network: response too large");
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("network:")) throw err;
    throw new Error(`network: ${reason(err)}`);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createHttpJson(o: {
  userAgent: string;
  timeoutMs: number;
  maxBytes?: number;
}): HttpJson {
  const maxBytes = o.maxBytes ?? MAX_BYTES;
  async function request(
    url: string,
    first: RequestInit,
    headers: Record<string, string>,
  ): Promise<{
    status: number;
    headers: Record<string, string>;
    text: string;
  }> {
    let current: URL;
    try {
      current = new URL(url);
    } catch {
      throw new Error("network: invalid URL");
    }
    let init = first;
    let sendHeaders = headers;
    const signal = AbortSignal.timeout(o.timeoutMs);
    for (let hop = 0; ; hop++) {
      let res: Response;
      try {
        res = await fetch(current, {
          ...init,
          redirect: "manual",
          signal,
          headers: { "user-agent": o.userAgent, ...sendHeaders },
        });
      } catch (err) {
        throw new Error(`network: ${reason(err)}`);
      }
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel().catch(() => {});
        if (hop >= MAX_HOPS) throw new Error("network: too many redirects");
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new Error("network: bad redirect");
        }
        if (next.protocol !== current.protocol || next.host !== current.host) {
          throw new Error("network: redirect to another host");
        }
        current = next;
        if (res.status === 301 || res.status === 302 || res.status === 303) {
          init = { method: "GET" };
          sendHeaders = Object.fromEntries(
            Object.entries(sendHeaders).filter(
              ([k]) => k.toLowerCase() !== "content-type",
            ),
          );
        }
        continue;
      }
      const text = await readCapped(res, maxBytes);
      return {
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        text,
      };
    }
  }
  return {
    getText: (url, opts) =>
      request(url, { method: "GET" }, opts?.headers ?? {}),
    async postJson(url, body, opts) {
      const r = await request(
        url,
        { method: "POST", body: JSON.stringify(body) },
        { "content-type": "application/json", ...(opts?.headers ?? {}) },
      );
      return { status: r.status, text: r.text };
    },
  };
}
