import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runGscAuth,
  runGscInspect,
  runGscQueries,
} from "../../src/commands/gsc.js";
import { saveToken } from "../../src/gsc/token-store.js";
import { createHttpJson } from "../../src/research/http.js";
import { serveDir, type TestServer } from "../support/server.js";

const CLI = path.resolve("dist/cli.js");
let server: TestServer | undefined;
let tmp: string | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

const http = createHttpJson({ userAgent: "t", timeoutMs: 5000 });
const opts = { adc: false, logout: false, noOpen: false };

function harness() {
  tmp = mkdtempSync(path.join(os.tmpdir(), "mielikki-gsc-"));
  let out = "";
  let err = "";
  const cfg = path.join(tmp, "cfg");
  return {
    tmp,
    token: path.join(cfg, "mielikki", "gsc-token.json"),
    io: {
      write: (s: string) => {
        out += s;
      },
      warn: (s: string) => {
        err += `${s}\n`;
      },
      env: { XDG_CONFIG_HOME: cfg } as NodeJS.ProcessEnv,
      home: tmp,
    },
    out: () => out,
    err: () => err,
  };
}

function clientFile(dir: string): string {
  const f = path.join(dir, "client.json");
  writeFileSync(
    f,
    JSON.stringify({
      installed: {
        client_id: "e2e-client-id",
        client_secret: "E2E-client-SECRET",
        auth_uri: "https://accounts.google.com/o/oauth2/v2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
      },
    }),
  );
  return f;
}

const SC = "https://www.googleapis.com/auth/webmasters.readonly";
const fake = (base: string) => ({
  authUri: `${base}/authorize`,
  tokenUri: `${base}/token`,
});

const browser =
  (code: string) =>
  (u: string): void => {
    const p = new URL(u).searchParams;
    void fetch(
      `${p.get("redirect_uri")}/?code=${code}&state=${p.get("state")}`,
    );
  };

describe("gsc auth", () => {
  it("full login stores a 0600 token and prints no secrets", async () => {
    const h = harness();
    server = await serveDir(h.tmp, {
      oauth: () => ({
        body: JSON.stringify({
          refresh_token: "REFRESH-tok-E2E",
          access_token: "ACCESS-tok-E2E",
          scope: SC,
        }),
      }),
    });
    const code = await runGscAuth(
      { ...opts, client: clientFile(h.tmp) },
      h.io,
      {
        http,
        ...fake(server.url),
        openUrl: browser("AUTHCODE-e2e1"),
        timeoutMs: 5000,
      },
    );
    expect(code).toBe(0);
    expect(statSync(h.token).mode & 0o777).toBe(0o600);
    expect(readFileSync(h.token, "utf8")).toContain("REFRESH-tok-E2E");
    const all = h.out() + h.err();
    for (const s of [
      "E2E-client-SECRET",
      "REFRESH-tok-E2E",
      "ACCESS-tok-E2E",
      "AUTHCODE-e2e1",
      server.oauthLog[0]?.get("code_verifier") ?? "x-missing",
    ])
      expect(all).not.toContain(s);
    // second run without flags reports the stored source
    let o2 = "";
    expect(
      await runGscAuth(opts, { ...h.io, write: (s) => (o2 += s) }, { http }),
    ).toBe(0);
    expect(o2).toMatch(/уже авторизовано/i);
  });

  it("no leakage when the token endpoint echoes the request body", async () => {
    const h = harness();
    server = await serveDir(h.tmp, {
      oauth: (form) => ({
        status: 400,
        body: JSON.stringify({
          error: "invalid_request",
          error_description: `bad request: ${form.toString()} ${JSON.stringify(Object.fromEntries(form))}`,
        }),
      }),
    });
    const code = await runGscAuth(
      { ...opts, client: clientFile(h.tmp) },
      h.io,
      {
        http,
        ...fake(server.url),
        openUrl: browser("AUTHCODE-leak9"),
        timeoutMs: 5000,
      },
    );
    expect(code).toBe(2);
    expect(existsSync(h.token)).toBe(false);
    const verifier = server.oauthLog[0]?.get("code_verifier") ?? "";
    expect(verifier.length).toBeGreaterThan(20);
    const all = h.out() + h.err();
    expect(h.err()).toContain("invalid_request");
    for (const s of ["E2E-client-SECRET", "AUTHCODE-leak9", verifier])
      expect(all).not.toContain(s);
    expect(all).not.toMatch(/client_secret|code_verifier|refresh_token/);
  });

  it("without flags and no token: exit 2 with step-by-step hint", async () => {
    const h = harness();
    expect(await runGscAuth(opts, h.io)).toBe(2);
    expect(h.err()).toContain("--client");
    expect(h.err()).toContain("Desktop app");
  });

  it("--logout removes the token", async () => {
    const h = harness();
    server = await serveDir(h.tmp, {
      oauth: () => ({
        body: JSON.stringify({ refresh_token: "REFRESH-tok-E2E" }),
      }),
    });
    await runGscAuth({ ...opts, client: clientFile(h.tmp) }, h.io, {
      http,
      ...fake(server.url),
      openUrl: browser("c-abcdef"),
      timeoutMs: 5000,
    });
    expect(await runGscAuth({ ...opts, logout: true }, h.io)).toBe(0);
    expect(existsSync(h.token)).toBe(false);
  });

  it("--adc stores only when the scope is right, rejects service accounts", async () => {
    const h = harness();
    const f = path.join(h.tmp, "adc.json");
    const adc = {
      type: "authorized_user",
      client_id: "c",
      client_secret: "cs",
      refresh_token: "rt-adc-1",
    };
    writeFileSync(f, JSON.stringify(adc));
    const io = {
      ...h.io,
      env: { ...h.io.env, GOOGLE_APPLICATION_CREDENTIALS: f },
    };
    let scope = "https://www.googleapis.com/auth/cloud-platform";
    server = await serveDir(h.tmp, {
      oauth: () => ({ body: JSON.stringify({ access_token: "acc-1", scope }) }),
    });
    const deps = { http, tokenUri: `${server.url}/token` };
    expect(await runGscAuth({ ...opts, adc: true }, io, deps)).toBe(2);
    expect(h.err()).toContain(
      "gcloud auth application-default login --scopes=https://www.googleapis.com/auth/webmasters.readonly,https://www.googleapis.com/auth/cloud-platform",
    );
    expect(existsSync(h.token)).toBe(false);
    scope = `${SC} https://www.googleapis.com/auth/cloud-platform`;
    expect(await runGscAuth({ ...opts, adc: true }, io, deps)).toBe(0);
    expect(h.out()).toContain("adc");
    expect(existsSync(h.token)).toBe(true);
    writeFileSync(f, JSON.stringify({ type: "service_account" }));
    expect(await runGscAuth({ ...opts, adc: true }, io, deps)).toBe(2);
    expect(h.err()).toContain("authorized_user");
  });

  it("--adc with --client is a usage error", async () => {
    const h = harness();
    expect(
      await runGscAuth({ ...opts, adc: true, client: "x.json" }, h.io),
    ).toBe(2);
    expect(h.err()).toContain("--adc");
  });

  it("client with a foreign auth_uri: nothing opened, nothing posted", async () => {
    const h = harness();
    server = await serveDir(h.tmp, { oauth: () => ({ body: "{}" }) });
    const f = path.join(h.tmp, "evil.json");
    writeFileSync(
      f,
      JSON.stringify({
        installed: {
          client_id: "a",
          client_secret: "E2E-client-SECRET",
          auth_uri: "https://evil.example/auth",
          token_uri: `${server.url}/token`,
        },
      }),
    );
    let opened = 0;
    const code = await runGscAuth({ ...opts, client: f }, h.io, {
      http,
      openUrl: () => {
        opened++;
      },
    });
    expect(code).toBe(2);
    expect(opened).toBe(0);
    expect(server.oauthLog).toHaveLength(0);
    expect(h.out() + h.err()).not.toContain("evil");
  });

  it("logout wording does not claim a revoke", async () => {
    const h = harness();
    expect(await runGscAuth({ ...opts, logout: true }, h.io)).toBe(0);
    expect(h.out()).toContain("myaccount.google.com/permissions");
    expect(h.out()).toContain("или его не было");
  });

  it("CLI: gsc auth without args exits 2", () => {
    const h = harness();
    const r = spawnSync("node", [CLI, "gsc", "auth"], {
      encoding: "utf8",
      env: { ...process.env, XDG_CONFIG_HOME: path.join(h.tmp, "cfg") },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Desktop app");
  });
});

describe("gsc inspect and queries", () => {
  const ACCESS = "ACCESS-tok-INSPECT-99";
  const REFRESH = "REFRESH-tok-INSPECT-99";
  const CLIENT_SECRET = "CLIENT-secret-INSPECT-99";
  const inspectOpts = {
    from: "sitemap" as const,
    limit: 200,
    format: "json" as const,
    noMeta: true,
  };
  const queryOpts = {
    days: 28,
    rowLimit: 1000,
    byTarget: false,
    format: "json" as const,
    noMeta: true,
  };

  const indexed = (verdict: string) =>
    JSON.stringify({
      inspectionResult: {
        indexStatusResult: {
          verdict,
          coverageState:
            verdict === "PASS" ? "Indexed" : "Crawled - not indexed",
          googleCanonical: "https://example.fi/x/",
        },
      },
    });

  async function setup(
    gsc: NonNullable<Parameters<typeof serveDir>[1]>["gsc"],
    configExtra = "",
  ) {
    const h = harness();
    await saveToken(h.token, {
      clientId: "cid",
      clientSecret: CLIENT_SECRET,
      refreshToken: REFRESH,
      source: "oauth-client",
    });
    const srv = await serveDir(h.tmp, {
      gsc,
      oauth: () => ({
        body: JSON.stringify({ access_token: ACCESS, scope: SC }),
      }),
    });
    server = srv;
    const site = srv.url;
    const loc = (p: string) => `<url><loc>${site}${p}</loc></url>`;
    srv.requests.length = 0;
    writeFileSync(
      path.join(h.tmp, "mielikki.config.yaml"),
      `site: ${site}\nlanguage: fi\n${configExtra}`,
    );
    writeFileSync(
      path.join(h.tmp, "sitemap.xml"),
      `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${loc("/a/")}${loc("/b/")}${loc("/c/")}${loc("/d/")}<url><loc>https://evil.example/z/</loc></url></urlset>`,
    );
    const deps = {
      http,
      tokenUri: `${srv.url}/token`,
      inspectBase: srv.url,
      analyticsBase: srv.url,
      sleep: async () => {},
      now: () => new Date("2026-11-03T10:00:00Z"),
    };
    const io = { ...h.io, cwd: h.tmp };
    return { h, srv, deps, io };
  }

  const noLeak = (text: string) => {
    for (const s of [ACCESS, REFRESH, CLIENT_SECRET])
      expect(text).not.toContain(s);
  };

  it("inspect writes one row per sitemap URL, summarises on stderr, stays on allowed hosts", async () => {
    const { h, srv, deps, io } = await setup((_r, body) => ({
      body: indexed(
        String(body.inspectionUrl).endsWith("/b/") ? "NEUTRAL" : "PASS",
      ),
    }));
    const code = await runGscInspect(
      { ...inspectOpts, output: "out/inspect.json" },
      io,
      deps,
    );
    expect(code).toBe(0);
    const file = JSON.parse(
      readFileSync(path.join(h.tmp, "out/inspect.json"), "utf8"),
    );
    expect(file.kind).toBe("gsc-inspect");
    expect(file.rows.map((r: { url: string }) => r.url)).toEqual(
      ["/a/", "/b/", "/c/", "/d/"].map((p) => srv.url + p),
    );
    expect(file.rows[1].verdict).toBe("NEUTRAL");
    expect(h.err()).toContain("проверено 4 из 4");
    expect(h.err()).toContain("NEUTRAL 1");
    expect(h.err()).toContain("PASS 3");
    expect(h.err()).toContain(`${srv.url}/b/`);
    expect(h.out()).toBe("");
    for (const l of srv.gscLog) {
      expect(l.auth).toBe(`Bearer ${ACCESS}`);
      expect(l.body.siteUrl).toBe(`${srv.url}/`);
      expect(l.body.languageCode).toBe("fi");
    }
    expect(
      srv.requests.filter(
        (p) => p !== "/token" && p !== "/v1/urlInspection/index:inspect",
      ),
    ).toEqual(["/sitemap.xml"]);
    noLeak(
      h.out() +
        h.err() +
        readFileSync(path.join(h.tmp, "out/inspect.json"), "utf8"),
    );
    expect(existsSync(path.join(h.tmp, ".mielikki"))).toBe(false);
  });

  it("quota on the 3rd call: exit 1, partial file with 2 rows", async () => {
    const { h, deps, io } = await setup((_r, _b, ctx) =>
      ctx.n === 3
        ? {
            status: 429,
            body: JSON.stringify({
              error: { status: "RESOURCE_EXHAUSTED", message: ACCESS },
            }),
          }
        : { body: indexed("PASS") },
    );
    const code = await runGscInspect(
      { ...inspectOpts, output: "p.json" },
      io,
      deps,
    );
    expect(code).toBe(1);
    const file = JSON.parse(readFileSync(path.join(h.tmp, "p.json"), "utf8"));
    expect(file.rows).toHaveLength(2);
    expect(h.err()).toContain(
      "проверено 2 из 4; квота обновляется раз в сутки",
    );
    noLeak(h.out() + h.err());
  });

  it("403 gives the access hint with exit 2; no token gives setup help", async () => {
    const { h, deps, io } = await setup(() => ({
      status: 403,
      body: `{"error":"${ACCESS}"}`,
    }));
    expect(await runGscInspect(inspectOpts, io, deps)).toBe(2);
    expect(h.err()).toContain("Нет доступа к ресурсу");
    noLeak(h.out() + h.err());

    const h2 = harness();
    writeFileSync(
      path.join(h2.tmp, "mielikki.config.yaml"),
      "site: http://127.0.0.1:1\n",
    );
    expect(
      await runGscQueries(queryOpts, { ...h2.io, cwd: h2.tmp }, { http }),
    ).toBe(2);
    expect(h2.err()).toContain("gsc auth");
  });

  it("queries encodes sc-domain, uses UTC dates ending 2 days ago and prints target coverage", async () => {
    const { h, srv, deps, io } = await setup(
      () => ({
        body: JSON.stringify({
          rows: [
            {
              keys: ["sähköasennus loviisassa", "/"],
              clicks: 2,
              impressions: 30,
              ctr: 0.06,
              position: 8,
            },
            {
              keys: ["sähköasennus porvoo", "/porvoo/"],
              clicks: 0,
              impressions: 5,
              ctr: 0,
              position: 30,
            },
          ],
        }),
      }),
      "targets:\n  pages:\n    - url: /loviisa/\n      primary: sähköasennukset loviisa\n    - url: /kerava/\n      primary: sähköasennukset kerava\n",
    );
    const code = await runGscQueries(
      { ...queryOpts, site: "sc-domain:example.fi", byTarget: true },
      io,
      deps,
    );
    expect(code).toBe(0);
    expect(srv.gscLog[0]?.path).toBe(
      "/webmasters/v3/sites/sc-domain%3Aexample.fi/searchAnalytics/query",
    );
    expect(srv.gscLog[0]?.body).toMatchObject({
      startDate: "2026-10-05",
      endDate: "2026-11-01",
      dimensions: ["query", "page"],
      rowLimit: 1000,
    });
    const out = JSON.parse(h.out());
    expect(
      out.rows.map((r: { target: string; status: string }) => [
        r.target,
        r.status,
      ]),
    ).toEqual([
      ["/loviisa/", "other-page"],
      ["/kerava/", "no-data"],
    ]);
    expect(out.rows[0].topQueries).toBe("sähköasennus loviisassa");
    noLeak(h.out() + h.err());
  });

  it("queries without --by-target lists rows sorted by impressions", async () => {
    const { h, deps, io } = await setup(() => ({
      body: JSON.stringify({
        rows: [
          { keys: ["b", "/"], clicks: 1, impressions: 1, ctr: 1, position: 1 },
          {
            keys: ["a", "/"],
            clicks: 1,
            impressions: 9,
            ctr: 0.1,
            position: 2,
          },
        ],
      }),
    }));
    expect(await runGscQueries(queryOpts, io, deps)).toBe(0);
    expect(
      JSON.parse(h.out()).rows.map((r: { query: string }) => r.query),
    ).toEqual(["a", "b"]);
  });

  it("queries paginates with startRow and warns when the limit truncates", async () => {
    const mk = (a: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        keys: [`q${a + i}`, "/"],
        clicks: 0,
        impressions: 1000 - (a + i),
        ctr: 0,
        position: 3,
      }));
    const { h, srv, deps, io } = await setup((_r, body) => ({
      body: JSON.stringify({
        rows: mk(Number(body.startRow ?? 0), Number(body.rowLimit)),
      }),
    }));
    // page size is capped at 25000, so 30000 needs two requests
    const code = await runGscQueries(
      { ...queryOpts, rowLimit: 30000 },
      io,
      deps,
    );
    expect(code).toBe(0);
    expect(
      srv.gscLog.map((l) => [l.body.startRow ?? 0, l.body.rowLimit]),
    ).toEqual([
      [0, 25000],
      [25000, 5000],
    ]);
    expect(JSON.parse(h.out()).rows).toHaveLength(30000);
    expect(h.err()).toContain(
      "данные усечены до 30000 строк; увеличьте --row-limit (максимум 25000 на запрос, пагинация до 100000)",
    );
  });

  it("queries stops after a short page without a truncation warning", async () => {
    const { h, srv, deps, io } = await setup(() => ({
      body: JSON.stringify({
        rows: [
          { keys: ["a", "/"], clicks: 1, impressions: 1, ctr: 1, position: 1 },
        ],
      }),
    }));
    expect(await runGscQueries(queryOpts, io, deps)).toBe(0);
    expect(srv.gscLog).toHaveLength(1);
    expect(h.err()).not.toContain("усечены");
  });

  it("by-target names the competing URLs in otherPages", async () => {
    const { h, deps, io } = await setup(
      () => ({
        body: JSON.stringify({
          rows: [
            {
              keys: ["sähköasennus loviisa", "https://x.fi/b/"],
              clicks: 1,
              impressions: 9,
              ctr: 0,
              position: 4,
            },
            {
              keys: ["loviisan sähköasennukset", "https://x.fi/a/"],
              clicks: 1,
              impressions: 8,
              ctr: 0,
              position: 5,
            },
          ],
        }),
      }),
      "targets:\n  pages:\n    - url: /loviisa/\n      primary: sähköasennukset loviisa\n",
    );
    expect(
      await runGscQueries({ ...queryOpts, byTarget: true }, io, deps),
    ).toBe(0);
    const row = JSON.parse(h.out()).rows[0];
    expect(row.status).toBe("other-page");
    expect(row.otherPages).toBe("https://x.fi/a/; https://x.fi/b/");
  });

  it("inspect: denominators agree and --limit leftovers are mentioned", async () => {
    const { h, deps, io } = await setup((_r, _b, ctx) =>
      ctx.n === 2 ? { status: 429, body: "{}" } : { body: indexed("PASS") },
    );
    expect(await runGscInspect({ ...inspectOpts, limit: 3 }, io, deps)).toBe(1);
    expect(h.err()).toContain("проверено 1 из 3");
    expect(h.err()).not.toContain("из 4");
    expect(h.err()).toContain("Ещё 1 страниц не проверено из-за --limit 3");
    expect(h.err()).toContain(
      "проверено 1 из 3; квота обновляется раз в сутки",
    );
  });

  it("inspect: 5xx is retried after a pause; 5 consecutive failures abort with a partial file", async () => {
    const sleeps: number[] = [];
    const { h, srv, deps, io } = await setup((_r, _b, ctx) =>
      ctx.n === 1 ? { body: indexed("PASS") } : { status: 503, body: "x" },
    );
    writeFileSync(
      path.join(h.tmp, "sitemap.xml"),
      `<urlset>${Array.from({ length: 12 }, (_, i) => `<url><loc>${srv.url}/p${String(i).padStart(2, "0")}/</loc></url>`).join("")}</urlset>`,
    );
    const code = await runGscInspect({ ...inspectOpts, output: "f.json" }, io, {
      ...deps,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(code).toBe(1);
    const file = JSON.parse(readFileSync(path.join(h.tmp, "f.json"), "utf8"));
    expect(file.rows).toHaveLength(1);
    expect(file.errors).toHaveLength(5);
    expect(h.err()).toContain("прервано после 5 ошибок подряд");
    // each failing URL: 2 attempts (one retry) -> 1 + 5*2 calls, far fewer than 12 URLs
    expect(srv.gscLog).toHaveLength(11);
    expect(sleeps.filter((m) => m >= 100).length).toBeGreaterThanOrEqual(5);
  });

  it("inspect: a mid-run 403 writes the partial file first, then exits 2", async () => {
    const { h, deps, io } = await setup((_r, _b, ctx) =>
      ctx.n === 3 ? { status: 403, body: "{}" } : { body: indexed("PASS") },
    );
    const code = await runGscInspect(
      { ...inspectOpts, output: "m.json" },
      io,
      deps,
    );
    expect(code).toBe(2);
    const file = JSON.parse(readFileSync(path.join(h.tmp, "m.json"), "utf8"));
    expect(file.rows).toHaveLength(2);
    expect(h.err()).toContain("Нет доступа к ресурсу");
  });

  it("inspect: sitemap children on another port are not requested", async () => {
    const other = await serveDir(tmp ?? ".", {
      extra: { "/sm.xml": { type: "application/xml", body: "<urlset/>" } },
    });
    try {
      const { h, srv, deps, io } = await setup(() => ({
        body: indexed("PASS"),
      }));
      writeFileSync(
        path.join(h.tmp, "sitemap.xml"),
        `<sitemapindex><sitemap><loc>${other.url}/sm.xml</loc></sitemap><sitemap><loc>${srv.url}/sm-a.xml</loc></sitemap></sitemapindex>`,
      );
      writeFileSync(
        path.join(h.tmp, "sm-a.xml"),
        `<urlset><url><loc>${srv.url}/only/</loc></url><url><loc>${other.url}/foreign/</loc></url></urlset>`,
      );
      expect(
        await runGscInspect({ ...inspectOpts, output: "o.json" }, io, deps),
      ).toBe(0);
      const file = JSON.parse(readFileSync(path.join(h.tmp, "o.json"), "utf8"));
      expect(file.rows.map((r: { url: string }) => r.url)).toEqual([
        `${srv.url}/only/`,
      ]);
      expect(other.requests).toEqual([]);
      expect(srv.gscLog.map((l) => l.body.inspectionUrl)).toEqual([
        `${srv.url}/only/`,
      ]);
    } finally {
      await other.close();
    }
  });

  it("CLI wires gsc inspect and queries (exit 2 without config site/token)", () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "mielikki-gsc-cli-"));
    const r = spawnSync("node", [CLI, "gsc", "queries"], {
      cwd: tmp,
      encoding: "utf8",
      env: { ...process.env, XDG_CONFIG_HOME: path.join(tmp, "c"), HOME: tmp },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--site");
    const h = spawnSync("node", [CLI, "gsc", "inspect", "--help"], {
      encoding: "utf8",
    });
    expect(h.stdout).toContain("--limit");
  });
});
