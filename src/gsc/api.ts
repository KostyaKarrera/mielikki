import { UsageError } from "../errors.js";
import type { HttpJson } from "../research/http.js";
import { redact } from "./redact.js";

export interface InspectRow {
  url: string;
  verdict: string;
  coverageState: string;
  indexingState: string;
  robotsTxtState: string;
  pageFetchState: string;
  googleCanonical: string | null;
  userCanonical: string | null;
  lastCrawlTime: string | null;
}

export interface QueryRow {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** Quota exhausted (HTTP 429 / quotaExceeded). `done` is filled in by the caller. */
export class GscQuotaError extends Error {
  constructor(readonly done: number = 0) {
    super("Search Console: квота исчерпана");
    this.name = "GscQuotaError";
  }
}

export const DEFAULT_INSPECT_BASE = "https://searchconsole.googleapis.com";
export const DEFAULT_ANALYTICS_BASE = "https://www.googleapis.com";

export interface GscClient {
  inspectUrl(
    siteUrl: string,
    url: string,
    languageCode: string,
  ): Promise<InspectRow>;
  queryAnalytics(
    siteUrl: string,
    q: { startDate: string; endDate: string; rowLimit: number },
  ): Promise<QueryRow[]>;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : null;
const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

function isQuotaBody(text: string): boolean {
  try {
    const e = obj(obj(JSON.parse(text)).error);
    const status = str(e.status);
    const reasons = (Array.isArray(e.errors) ? e.errors : []).map((x) =>
      str(obj(x).reason),
    );
    return [status, ...reasons].some((s) =>
      /quota|ratelimit|resource_exhausted/i.test(s),
    );
  } catch {
    return false;
  }
}

export function createGscClient(
  accessToken: string,
  http: HttpJson,
  base: { inspect?: string; analytics?: string } = {},
): GscClient {
  const inspectBase = (base.inspect ?? DEFAULT_INSPECT_BASE).replace(/\/$/, "");
  const analyticsBase = (base.analytics ?? DEFAULT_ANALYTICS_BASE).replace(
    /\/$/,
    "",
  );
  const headers = { authorization: `Bearer ${accessToken}` };

  async function post(
    url: string,
    body: unknown,
    siteUrl: string,
  ): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      let res: { status: number; text: string };
      try {
        res = await http.postJson(url, body, { headers });
      } catch (err) {
        const m = err instanceof Error ? err.message : "request failed";
        throw new Error(
          redact(`Не удалось связаться с Search Console (${m.slice(0, 80)})`, [
            accessToken,
          ]),
        );
      }
      if (res.status >= 200 && res.status < 300) {
        try {
          return JSON.parse(res.text);
        } catch {
          throw new Error("Search Console вернул ответ не в формате JSON");
        }
      }
      if (res.status === 401)
        throw new UsageError(
          "Search Console отклонил доступ (401): выполните mielikki gsc auth",
        );
      if (res.status === 429 || (res.status === 403 && isQuotaBody(res.text)))
        throw new GscQuotaError();
      if (res.status === 403)
        throw new UsageError(
          `Нет доступа к ресурсу ${redact(siteUrl, [accessToken])}: добавьте пользователя в Search Console или укажите --site sc-domain:…`,
        );
      if (res.status >= 500 && attempt === 0) continue;
      throw new Error(
        res.status >= 500
          ? `Search Console временно недоступен (HTTP ${res.status})`
          : `Search Console отклонил запрос (HTTP ${res.status})`,
      );
    }
  }

  return {
    async inspectUrl(siteUrl, url, languageCode) {
      const json = await post(
        `${inspectBase}/v1/urlInspection/index:inspect`,
        { inspectionUrl: url, siteUrl, languageCode },
        siteUrl,
      );
      const s = obj(obj(obj(json).inspectionResult).indexStatusResult);
      return {
        url,
        verdict: str(s.verdict) || "UNKNOWN",
        coverageState: str(s.coverageState),
        indexingState: str(s.indexingState),
        robotsTxtState: str(s.robotsTxtState),
        pageFetchState: str(s.pageFetchState),
        googleCanonical: strOrNull(s.googleCanonical),
        userCanonical: strOrNull(s.userCanonical),
        lastCrawlTime: strOrNull(s.lastCrawlTime),
      };
    },
    async queryAnalytics(siteUrl, q) {
      const json = await post(
        `${analyticsBase}/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
        {
          startDate: q.startDate,
          endDate: q.endDate,
          dimensions: ["query", "page"],
          rowLimit: q.rowLimit,
        },
        siteUrl,
      );
      const rows = obj(json).rows;
      const out: QueryRow[] = [];
      for (const r of Array.isArray(rows) ? rows : []) {
        const o = obj(r);
        const keys = Array.isArray(o.keys) ? o.keys : [];
        if (typeof keys[0] !== "string" || typeof keys[1] !== "string")
          continue;
        out.push({
          query: keys[0],
          page: keys[1],
          clicks: num(o.clicks),
          impressions: num(o.impressions),
          ctr: num(o.ctr),
          position: num(o.position),
        });
      }
      return out;
    },
  };
}
