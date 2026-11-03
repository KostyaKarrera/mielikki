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

function reason(err: unknown): string {
  const e = err as {
    name?: string;
    message?: string;
    cause?: { code?: string };
  };
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "timeout";
  return (e?.cause?.code ?? e?.message ?? "request failed").slice(0, 100);
}

export function createHttpJson(o: {
  userAgent: string;
  timeoutMs: number;
}): HttpJson {
  async function request(
    url: string,
    init: RequestInit,
    headers: Record<string, string>,
  ): Promise<{
    status: number;
    headers: Record<string, string>;
    text: string;
  }> {
    let current = new URL(url);
    const host = current.host;
    for (let hop = 0; ; hop++) {
      let res: Response;
      try {
        res = await fetch(current, {
          ...init,
          redirect: "manual",
          signal: AbortSignal.timeout(o.timeoutMs),
          headers: { "user-agent": o.userAgent, ...headers },
        });
      } catch (err) {
        throw new Error(`network: ${reason(err)}`);
      }
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        if (hop >= MAX_HOPS) throw new Error("network: too many redirects");
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new Error("network: bad redirect");
        }
        if (next.host !== host) {
          throw new Error("network: redirect to another host");
        }
        current = next;
        if (res.status === 301 || res.status === 302 || res.status === 303) {
          init = { method: "GET" };
        }
        continue;
      }
      try {
        const text = await res.text();
        return {
          status: res.status,
          headers: Object.fromEntries(res.headers.entries()),
          text,
        };
      } catch (err) {
        throw new Error(`network: ${reason(err)}`);
      }
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
