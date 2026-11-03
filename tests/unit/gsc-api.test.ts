import { describe, expect, it } from "vitest";
import { UsageError } from "../../src/errors.js";
import { createGscClient, GscQuotaError } from "../../src/gsc/api.js";
import type { HttpJson } from "../../src/research/http.js";

const TOKEN = "ya29.SECRET-access-token";

interface Call {
  url: string;
  body: unknown;
  headers?: Record<string, string>;
}

function fake(replies: { status: number; text: string }[]): {
  http: HttpJson;
  calls: Call[];
} {
  const calls: Call[] = [];
  let i = 0;
  const http: HttpJson = {
    getText: async () => {
      throw new Error("unused");
    },
    postForm: async () => {
      throw new Error("unused");
    },
    postJson: async (url, body, o) => {
      calls.push({ url, body, headers: o?.headers });
      const r = replies[Math.min(i++, replies.length - 1)];
      if (!r) throw new Error("no reply");
      return r;
    },
  };
  return { http, calls };
}

const ok = (o: unknown) => ({ status: 200, text: JSON.stringify(o) });

describe("createGscClient", () => {
  it("inspectUrl sends the documented body with a bearer token and maps the result", async () => {
    const { http, calls } = fake([
      ok({
        inspectionResult: {
          indexStatusResult: {
            verdict: "PASS",
            coverageState: "Submitted and indexed",
            indexingState: "INDEXING_ALLOWED",
            robotsTxtState: "ALLOWED",
            pageFetchState: "SUCCESSFUL",
            googleCanonical: "https://example.fi/a/",
            lastCrawlTime: "2026-10-30T10:00:00Z",
          },
        },
      }),
    ]);
    const c = createGscClient(TOKEN, http, { inspect: "http://i.test" });
    const row = await c.inspectUrl(
      "https://example.fi/",
      "https://example.fi/a/",
      "fi",
    );
    expect(calls[0]?.url).toBe("http://i.test/v1/urlInspection/index:inspect");
    expect(calls[0]?.body).toEqual({
      inspectionUrl: "https://example.fi/a/",
      siteUrl: "https://example.fi/",
      languageCode: "fi",
    });
    expect(calls[0]?.headers).toEqual({ authorization: `Bearer ${TOKEN}` });
    expect(row).toEqual({
      url: "https://example.fi/a/",
      verdict: "PASS",
      coverageState: "Submitted and indexed",
      indexingState: "INDEXING_ALLOWED",
      robotsTxtState: "ALLOWED",
      pageFetchState: "SUCCESSFUL",
      googleCanonical: "https://example.fi/a/",
      userCanonical: null,
      lastCrawlTime: "2026-10-30T10:00:00Z",
    });
  });

  it("inspectUrl tolerates a missing indexStatusResult", async () => {
    const { http } = fake([ok({ inspectionResult: {} })]);
    const row = await createGscClient(TOKEN, http).inspectUrl("s", "u", "fi");
    expect(row.verdict).toBe("UNKNOWN");
    expect(row.googleCanonical).toBeNull();
    expect(row.lastCrawlTime).toBeNull();
  });

  it("queryAnalytics encodes sc-domain siteUrl and keeps ctr/position as returned", async () => {
    const { http, calls } = fake([
      ok({
        rows: [
          {
            keys: ["sähköasennus loviisa", "https://example.fi/"],
            clicks: 3,
            impressions: 40,
            ctr: 0.075,
            position: 7.25,
          },
          { keys: ["bad"], clicks: 1 },
        ],
      }),
    ]);
    const c = createGscClient(TOKEN, http, { analytics: "http://a.test/" });
    const rows = await c.queryAnalytics("sc-domain:example.fi", {
      startDate: "2026-10-05",
      endDate: "2026-11-01",
      rowLimit: 500,
    });
    expect(calls[0]?.url).toBe(
      "http://a.test/webmasters/v3/sites/sc-domain%3Aexample.fi/searchAnalytics/query",
    );
    expect(calls[0]?.body).toEqual({
      startDate: "2026-10-05",
      endDate: "2026-11-01",
      dimensions: ["query", "page"],
      rowLimit: 500,
    });
    expect(rows).toEqual([
      {
        query: "sähköasennus loviisa",
        page: "https://example.fi/",
        clicks: 3,
        impressions: 40,
        ctr: 0.075,
        position: 7.25,
      },
    ]);
  });

  it("no rows in the response gives an empty list", async () => {
    const { http } = fake([ok({})]);
    expect(
      await createGscClient(TOKEN, http).queryAnalytics("s", {
        startDate: "a",
        endDate: "b",
        rowLimit: 1,
      }),
    ).toEqual([]);
  });
});

describe("api_error_messages", () => {
  const run = (replies: { status: number; text: string }[]) =>
    createGscClient(TOKEN, fake(replies).http).inspectUrl(
      "sc-domain:x.fi",
      "u",
      "fi",
    );

  it("401 -> UsageError with the gsc auth hint", async () => {
    const e = await run([
      { status: 401, text: `{"error":"echo ${TOKEN}"}` },
    ]).catch((x) => x);
    expect(e).toBeInstanceOf(UsageError);
    expect(e.message).toContain("mielikki gsc auth");
    expect(e.message).not.toContain(TOKEN);
  });

  it("403 -> UsageError naming the resource", async () => {
    const e = await run([
      { status: 403, text: `{"error":{"message":"${TOKEN}"}}` },
    ]).catch((x) => x);
    expect(e).toBeInstanceOf(UsageError);
    expect(e.message).toContain("sc-domain:x.fi");
    expect(e.message).toContain("--site sc-domain:");
    expect(e.message).not.toContain(TOKEN);
  });

  it("429 and 403 quotaExceeded -> GscQuotaError", async () => {
    expect(
      await run([{ status: 429, text: "{}" }]).catch((x) => x),
    ).toBeInstanceOf(GscQuotaError);
    const q = JSON.stringify({
      error: { errors: [{ reason: "quotaExceeded" }] },
    });
    expect(
      await run([{ status: 403, text: q }]).catch((x) => x),
    ).toBeInstanceOf(GscQuotaError);
  });

  it("5xx is retried once, then fails; success on retry works", async () => {
    const { http, calls } = fake([{ status: 503, text: TOKEN }]);
    const e = await createGscClient(TOKEN, http)
      .inspectUrl("s", "u", "fi")
      .catch((x) => x);
    expect(calls).toHaveLength(2);
    expect(e.message).toContain("503");
    expect(e.message).not.toContain(TOKEN);
    const r = fake([{ status: 500, text: "" }, ok({ inspectionResult: {} })]);
    expect(
      (await createGscClient(TOKEN, r.http).inspectUrl("s", "u", "fi")).verdict,
    ).toBe("UNKNOWN");
  });

  it("waits before the single 5xx retry and sends startRow only when set", async () => {
    const waits: number[] = [];
    const r = fake([{ status: 502, text: "" }, ok({ rows: [] })]);
    const c = createGscClient(TOKEN, r.http, {}, async (ms) => {
      waits.push(ms);
    });
    await c.queryAnalytics("s", {
      startDate: "a",
      endDate: "b",
      rowLimit: 5,
      startRow: 5,
    });
    expect(waits).toEqual([100]);
    expect(r.calls[1]?.body).toMatchObject({ startRow: 5 });
    const r2 = fake([ok({ rows: [] })]);
    await createGscClient(TOKEN, r2.http).queryAnalytics("s", {
      startDate: "a",
      endDate: "b",
      rowLimit: 5,
    });
    expect(r2.calls[0]?.body).not.toHaveProperty("startRow");
  });

  it("transport errors never carry the token", async () => {
    const http: HttpJson = {
      getText: async () => {
        throw new Error("x");
      },
      postForm: async () => {
        throw new Error("x");
      },
      postJson: async () => {
        throw new Error(`network: boom ${TOKEN}`);
      },
    };
    const e = await createGscClient(TOKEN, http)
      .inspectUrl("s", "u", "fi")
      .catch((x) => x);
    expect(e.message).not.toContain(TOKEN);
  });

  it("other 4xx uses a fixed message without the body", async () => {
    const e = await run([{ status: 400, text: `bad ${TOKEN}` }]).catch(
      (x) => x,
    );
    expect(e.message).toBe("Search Console отклонил запрос (HTTP 400)");
  });
});
