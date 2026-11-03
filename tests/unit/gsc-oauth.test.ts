import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UsageError } from "../../src/errors.js";
import {
  type ClientSecrets,
  getAccessToken,
  loadAdc,
  readClientFile,
  runLoopbackLogin,
} from "../../src/gsc/oauth.js";
import { createHttpJson } from "../../src/research/http.js";
import { serveDir, type TestServer } from "../support/server.js";

let server: TestServer | undefined;
let tmp: string | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});
const http = createHttpJson({ userAgent: "t", timeoutMs: 5000 });
const dir = (): string => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "mielikki-oauth-"));
  return tmp;
};

async function start(
  oauth: NonNullable<Parameters<typeof serveDir>[1]>["oauth"],
): Promise<ClientSecrets> {
  server = await serveDir(dir(), { oauth });
  return {
    clientId: "client-id-1",
    clientSecret: "client-secret-XYZ",
    authUri: `${server.url}/authorize`,
    tokenUri: `${server.url}/token`,
  };
}
const ok = (): { body: string } => ({
  body: JSON.stringify({
    refresh_token: "r-tok-123456",
    access_token: "a-tok-1",
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
  }),
});

describe("runLoopbackLogin", () => {
  it("sends PKCE S256, state, scope; verifier matches challenge", async () => {
    const c = await start(ok);
    let printed = "";
    const t = await runLoopbackLogin(
      c,
      {
        timeoutMs: 5000,
        print: (s) => {
          printed += s;
        },
        openUrl: (u) => {
          const a = new URL(u);
          const p = a.searchParams;
          void fetch(
            `${p.get("redirect_uri")}/?code=CODE-abcdef&state=${p.get("state")}`,
          );
        },
      },
      http,
    );
    const url = new URL(printed.split("\n").pop() ?? "");
    const p = url.searchParams;
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("scope")).toBe(
      "https://www.googleapis.com/auth/webmasters.readonly",
    );
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent");
    expect(p.get("state")?.length).toBeGreaterThanOrEqual(16);
    expect(p.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const form = server?.oauthLog[0];
    expect(form?.get("code")).toBe("CODE-abcdef");
    expect(form?.get("grant_type")).toBe("authorization_code");
    const verifier = form?.get("code_verifier") ?? "";
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(
      p.get("code_challenge"),
    );
    expect(t).toEqual({
      clientId: "client-id-1",
      clientSecret: "client-secret-XYZ",
      refreshToken: "r-tok-123456",
      source: "oauth-client",
    });
  });

  it("rejects a wrong state, keeps waiting, then accepts the right one", async () => {
    const c = await start(ok);
    let wrongStatus = 0;
    const t = await runLoopbackLogin(
      c,
      {
        timeoutMs: 5000,
        print: () => {},
        openUrl: (u) => {
          const p = new URL(u).searchParams;
          const ru = p.get("redirect_uri");
          void (async () => {
            wrongStatus = (await fetch(`${ru}/?code=EVIL-code1&state=nope`))
              .status;
            await fetch(`${ru}/?code=GOOD-code1&state=${p.get("state")}`);
          })();
        },
      },
      http,
    );
    expect(wrongStatus).toBe(400);
    expect(server?.oauthLog).toHaveLength(1);
    expect(server?.oauthLog[0]?.get("code")).toBe("GOOD-code1");
    expect(t.refreshToken).toBe("r-tok-123456");
  });

  it("missing code with correct state is rejected, not exchanged", async () => {
    const c = await start(ok);
    let st = 0;
    await expect(
      runLoopbackLogin(
        c,
        {
          timeoutMs: 400,
          print: () => {},
          openUrl: (u) => {
            const p = new URL(u).searchParams;
            void fetch(
              `${p.get("redirect_uri")}/?state=${p.get("state")}`,
            ).then((r) => {
              st = r.status;
            });
          },
        },
        http,
      ),
    ).rejects.toThrow(UsageError);
    expect(st).toBe(400);
    expect(server?.oauthLog).toHaveLength(0);
  });

  it("access_denied becomes UsageError", async () => {
    const c = await start(ok);
    await expect(
      runLoopbackLogin(
        c,
        {
          timeoutMs: 5000,
          print: () => {},
          openUrl: (u) => {
            const p = new URL(u).searchParams;
            void fetch(
              `${p.get("redirect_uri")}/?error=access_denied&state=${p.get("state")}`,
            );
          },
        },
        http,
      ),
    ).rejects.toThrow(/access_denied/);
    expect(server?.oauthLog).toHaveLength(0);
  });

  it("times out with UsageError and closes the port", async () => {
    const c = await start(ok);
    let port = 0;
    await expect(
      runLoopbackLogin(
        c,
        {
          timeoutMs: 150,
          print: () => {},
          openUrl: (u) => {
            port = Number(
              new URL(new URL(u).searchParams.get("redirect_uri") ?? "").port,
            );
          },
        },
        http,
      ),
    ).rejects.toThrow(UsageError);
    expect(port).toBeGreaterThan(0);
    const refused = await new Promise<boolean>((resolve) => {
      const s = net.connect(port, "127.0.0.1");
      s.on("connect", () => {
        s.destroy();
        resolve(false);
      });
      s.on("error", () => resolve(true));
    });
    expect(refused).toBe(true);
  });

  it("token endpoint error shows only the short error code", async () => {
    const c = await start((form) => ({
      status: 400,
      body: JSON.stringify({
        error: "invalid_request",
        error_description: form.toString(),
      }),
    }));
    const err = await runLoopbackLogin(
      c,
      {
        timeoutMs: 5000,
        print: () => {},
        openUrl: (u) => {
          const p = new URL(u).searchParams;
          void fetch(
            `${p.get("redirect_uri")}/?code=CODE-zzzzzz&state=${p.get("state")}`,
          );
        },
      },
      http,
    ).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(UsageError);
    expect((err as Error).message).toContain("invalid_request");
    expect((err as Error).message).not.toContain("CODE-zzzzzz");
    expect((err as Error).message).not.toContain("client-secret-XYZ");
  });
});

describe("scope checks and robustness", () => {
  const login = (c: ClientSecrets, extra: object = {}) =>
    runLoopbackLogin(
      c,
      {
        timeoutMs: 5000,
        print: () => {},
        openUrl: (u) => {
          const p = new URL(u).searchParams;
          void fetch(
            `${p.get("redirect_uri")}/?code=CODE-abcdef&state=${p.get("state")}`,
          );
        },
        ...extra,
      },
      http,
    );
  it("refuses a grant without webmasters.readonly", async () => {
    const c = await start(() => ({
      body: JSON.stringify({ refresh_token: "r-tok-123456", scope: "openid" }),
    }));
    await expect(login(c)).rejects.toThrow(/webmasters\.readonly/);
  });
  it("warns about broader scopes but succeeds", async () => {
    const c = await start(() => ({
      body: JSON.stringify({
        refresh_token: "r-tok-123456",
        scope:
          "https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/drive",
      }),
    }));
    let warned = "";
    const t = await login(c, { warn: (s: string) => (warned += s) });
    expect(t.refreshToken).toBe("r-tok-123456");
    expect(warned).toContain("больше прав");
  });
  it("a throwing print rejects and closes the server", async () => {
    const c = await start(ok);
    await expect(
      login(c, {
        print: () => {
          throw new Error("boom");
        },
        openUrl: () => {},
      }),
    ).rejects.toThrow(UsageError);
  });
  it("the success page is delivered completely", async () => {
    const c = await start(ok);
    let body = "";
    await login(c, {
      openUrl: (u: string) => {
        const p = new URL(u).searchParams;
        void fetch(
          `${p.get("redirect_uri")}/?code=CODE-abcdef&state=${p.get("state")}`,
        )
          .then((r) => r.text())
          .then((t) => (body = t));
      },
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(body).toContain("Готово");
  });
});

describe("getAccessToken", () => {
  const stored = {
    clientId: "cid",
    clientSecret: "client-secret-XYZ",
    refreshToken: "refresh-tok-1",
    source: "oauth-client" as const,
  };
  it("refresh grant returns the access token", async () => {
    const c = await start(ok);
    expect(await getAccessToken(stored, http, c.tokenUri)).toBe("a-tok-1");
    expect(server?.oauthLog[0]?.get("grant_type")).toBe("refresh_token");
    expect(server?.oauthLog[0]?.get("refresh_token")).toBe("refresh-tok-1");
  });
  it("invalid_grant tells to run gsc auth", async () => {
    const c = await start(() => ({
      status: 400,
      body: JSON.stringify({ error: "invalid_grant" }),
    }));
    await expect(getAccessToken(stored, http, c.tokenUri)).rejects.toThrow(
      /gsc auth/,
    );
  });
});

describe("readClientFile", () => {
  const write = (v: string): string => {
    const f = path.join(dir(), "client.json");
    writeFileSync(f, v);
    return f;
  };
  it("accepts a Desktop client", async () => {
    const f = write(
      JSON.stringify({
        installed: {
          client_id: "cid",
          client_secret: "csecret",
          auth_uri: "https://accounts.google.com/o/oauth2/auth",
          token_uri: "https://oauth2.googleapis.com/token",
        },
      }),
    );
    expect(await readClientFile(f)).toEqual({
      clientId: "cid",
      clientSecret: "csecret",
      authUri: "https://accounts.google.com/o/oauth2/auth",
      tokenUri: "https://oauth2.googleapis.com/token",
    });
  });
  it("web client mentions Desktop app, no content echo", async () => {
    const f = write(JSON.stringify({ web: { client_secret: "SHHH-secret" } }));
    const e = await readClientFile(f).catch((x: unknown) => x as Error);
    expect(e).toBeInstanceOf(UsageError);
    expect((e as Error).message).toContain("Desktop app");
    expect((e as Error).message).not.toContain("SHHH-secret");
  });
  it("garbage does not echo content", async () => {
    const e = await readClientFile(write("garbage SHHH-secret {")).catch(
      (x: unknown) => x as Error,
    );
    expect(e).toBeInstanceOf(UsageError);
    expect((e as Error).message).not.toContain("SHHH");
  });
  it.each([
    ["auth_uri on another https host", { auth_uri: "https://evil.example/a" }],
    [
      "token_uri on another https host",
      { token_uri: "https://evil.example/t" },
    ],
    ["token_uri on localhost http", { token_uri: "http://localhost:1/token" }],
    ["auth_uri on loopback http", { auth_uri: "http://127.0.0.1:1/a" }],
    [
      "token_uri look-alike host",
      { token_uri: "https://oauth2.googleapis.com.evil.example/t" },
    ],
  ])("rejects %s without echoing it", async (_n, extra) => {
    const f = write(
      JSON.stringify({
        installed: { client_id: "a", client_secret: "b", ...extra },
      }),
    );
    const e = await readClientFile(f).catch((x: unknown) => x as Error);
    expect(e).toBeInstanceOf(UsageError);
    expect((e as Error).message).not.toContain("evil");
    expect((e as Error).message).not.toContain("127.0.0.1");
  });
});

describe("loadAdc", () => {
  it("accepts authorized_user, rejects service_account", async () => {
    const d = dir();
    const f = path.join(d, "adc.json");
    writeFileSync(
      f,
      JSON.stringify({
        type: "authorized_user",
        client_id: "cid",
        client_secret: "cs",
        refresh_token: "rt",
      }),
    );
    expect(await loadAdc({ GOOGLE_APPLICATION_CREDENTIALS: f }, d)).toEqual({
      clientId: "cid",
      clientSecret: "cs",
      refreshToken: "rt",
      source: "adc",
    });
    writeFileSync(
      f,
      JSON.stringify({ type: "service_account", private_key: "KEY-xxxx" }),
    );
    const e = await loadAdc({ GOOGLE_APPLICATION_CREDENTIALS: f }, d).catch(
      (x: unknown) => x as Error,
    );
    expect(e).toBeInstanceOf(UsageError);
    expect((e as Error).message).toContain("authorized_user");
    expect((e as Error).message).not.toContain("KEY-xxxx");
  });
  it("returns undefined when the default file is absent", async () => {
    expect(await loadAdc({}, dir())).toBeUndefined();
  });
});
