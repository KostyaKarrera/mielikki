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
import { runGscAuth } from "../../src/commands/gsc.js";
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

function clientFile(dir: string, base: string): string {
  const f = path.join(dir, "client.json");
  writeFileSync(
    f,
    JSON.stringify({
      installed: {
        client_id: "e2e-client-id",
        client_secret: "E2E-client-SECRET",
        auth_uri: `${base}/authorize`,
        token_uri: `${base}/token`,
      },
    }),
  );
  return f;
}

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
        }),
      }),
    });
    const code = await runGscAuth(
      { ...opts, client: clientFile(h.tmp, server.url) },
      h.io,
      { http, openUrl: browser("AUTHCODE-e2e1"), timeoutMs: 5000 },
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
      { ...opts, client: clientFile(h.tmp, server.url) },
      h.io,
      { http, openUrl: browser("AUTHCODE-leak9"), timeoutMs: 5000 },
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
    await runGscAuth({ ...opts, client: clientFile(h.tmp, server.url) }, h.io, {
      http,
      openUrl: browser("c-abcdef"),
      timeoutMs: 5000,
    });
    expect(await runGscAuth({ ...opts, logout: true }, h.io)).toBe(0);
    expect(existsSync(h.token)).toBe(false);
  });

  it("--adc saves an authorized_user token, rejects service accounts", async () => {
    const h = harness();
    const f = path.join(h.tmp, "adc.json");
    writeFileSync(
      f,
      JSON.stringify({
        type: "authorized_user",
        client_id: "c",
        client_secret: "cs",
        refresh_token: "rt",
      }),
    );
    const io = {
      ...h.io,
      env: { ...h.io.env, GOOGLE_APPLICATION_CREDENTIALS: f },
    };
    expect(await runGscAuth({ ...opts, adc: true }, io)).toBe(0);
    expect(h.out()).toContain("adc");
    writeFileSync(f, JSON.stringify({ type: "service_account" }));
    expect(await runGscAuth({ ...opts, adc: true }, io)).toBe(2);
    expect(h.err()).toContain("authorized_user");
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
