import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { UsageError } from "../errors.js";
import type { HttpJson } from "../research/http.js";
import { redact } from "./redact.js";
import type { StoredToken } from "./token-store.js";

export const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
export const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const DEFAULT_AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth";

export interface ClientSecrets {
  clientId: string;
  clientSecret: string;
  authUri: string;
  tokenUri: string;
}

const DESKTOP_HINT =
  "create an OAuth client of type 'Desktop app' in Google Cloud Console and download its JSON";

const AUTH_HOST = "accounts.google.com";
const TOKEN_HOST = "oauth2.googleapis.com";

/** Only https and the exact Google host are accepted; the value is never echoed. */
function safeUri(
  v: unknown,
  fallback: string,
  host: string,
  name: string,
): string {
  const s = typeof v === "string" && v !== "" ? v : fallback;
  let u: URL | undefined;
  try {
    u = new URL(s);
  } catch {
    u = undefined;
  }
  if (u?.protocol !== "https:" || u.hostname !== host || u.port !== "")
    throw new UsageError(
      `Client file: ${name} must be https://${host}/…; ${DESKTOP_HINT}`,
    );
  return s;
}

/** Google "Desktop app" client file: {"installed": {...}}. Never echoes file content. */
export async function readClientFile(file: string): Promise<ClientSecrets> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new UsageError(
      `Could not read the client file as JSON; ${DESKTOP_HINT}`,
    );
  }
  const inst =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>).installed
      : undefined;
  if (typeof inst !== "object" || inst === null)
    throw new UsageError(
      `The client file is not of type "Desktop app"; ${DESKTOP_HINT}`,
    );
  const i = inst as Record<string, unknown>;
  if (typeof i.client_id !== "string" || typeof i.client_secret !== "string")
    throw new UsageError(
      `The client file has no client_id/client_secret ("Desktop app"); ${DESKTOP_HINT}`,
    );
  return {
    clientId: i.client_id,
    clientSecret: i.client_secret,
    authUri: safeUri(i.auth_uri, DEFAULT_AUTH_URI, AUTH_HOST, "auth_uri"),
    tokenUri: safeUri(i.token_uri, DEFAULT_TOKEN_URI, TOKEN_HOST, "token_uri"),
  };
}

export interface LoginIO {
  openUrl(url: string): void;
  print(s: string): void;
  warn?(s: string): void;
  timeoutMs: number;
}

/** Opens a URL without a shell; failures are ignored (the URL is always printed). */
export function defaultOpenUrl(url: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  try {
    const c = spawn(cmd, args, { stdio: "ignore", detached: true });
    c.on("error", () => {});
    c.unref();
  } catch {
    // ignored
  }
}

/** Error text from a token endpoint response: only a short `error` code, never the body. */
function googleError(text: string, secrets: string[]): string {
  let code = "";
  try {
    const e = (JSON.parse(text) as { error?: unknown }).error;
    if (typeof e === "string" && /^[a-z_]{1,40}$/.test(e)) code = e;
  } catch {
    // not JSON
  }
  return redact(code, secrets);
}

async function postToken(
  http_: HttpJson,
  uri: string,
  form: Record<string, string>,
  secrets: string[],
): Promise<{ status: number; text: string }> {
  try {
    return await http_.postForm(uri, form);
  } catch (err) {
    const m = err instanceof Error ? err.message : "request failed";
    throw new UsageError(
      redact(`Could not reach Google (${m.slice(0, 80)})`, secrets),
    );
  }
}

function parseTokens(text: string): {
  refresh?: string;
  access?: string;
  scope: string[];
} {
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    return {
      refresh:
        typeof o.refresh_token === "string" ? o.refresh_token : undefined,
      access: typeof o.access_token === "string" ? o.access_token : undefined,
      scope: typeof o.scope === "string" ? o.scope.split(/\s+/) : [],
    };
  } catch {
    return { scope: [] };
  }
}

interface Callback {
  code?: string;
  error?: string;
}

function waitForCallback(
  state: string,
  timeoutMs: number,
  onListening: (port: number) => void,
): Promise<Callback> {
  return new Promise<Callback>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      const reply = (status: number, text: string): void => {
        res.writeHead(status, {
          "content-type": "text/plain; charset=utf-8",
          connection: "close",
        });
        res.end(text);
      };
      if (req.method !== "GET" || u.pathname !== "/")
        return reply(404, "Not found");
      if (u.searchParams.get("state") !== state)
        return reply(400, "Invalid state: request rejected.");
      const error = u.searchParams.get("error");
      const code = u.searchParams.get("code");
      if (!error && !code) return reply(400, "No authorization code.");
      const result: Callback = error
        ? { error: /^[a-z_]{1,40}$/.test(error) ? error : "unknown" }
        : { code: code ?? undefined };
      res.once("close", () => finish(() => resolve(result)));
      reply(200, "Done. You can close this tab and return to the terminal.");
    });
    function finish(then: () => void): void {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      server.close(() => then());
      server.closeAllConnections();
    }
    server.on("error", () =>
      finish(() =>
        reject(new UsageError("Could not start the local server for sign-in")),
      ),
    );
    server.listen(0, "127.0.0.1", () => {
      timer = setTimeout(
        () =>
          finish(() =>
            reject(
              new UsageError("Sign-in timed out: run mielikki gsc auth again"),
            ),
          ),
        timeoutMs,
      );
      try {
        onListening((server.address() as AddressInfo).port);
      } catch {
        finish(() => reject(new UsageError("Could not show the sign-in link")));
      }
    });
  });
}

export async function runLoopbackLogin(
  c: ClientSecrets,
  io: LoginIO,
  http_: HttpJson,
): Promise<StoredToken> {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");
  let redirectUri = "";
  const cb = await waitForCallback(state, io.timeoutMs, (port) => {
    redirectUri = `http://127.0.0.1:${port}`;
    const url = new URL(c.authUri);
    url.search = new URLSearchParams({
      client_id: c.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPE,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent",
    }).toString();
    io.print(`Open the link in a browser and allow access:\n${url.toString()}`);
    io.openUrl(url.toString());
  });
  if (cb.error)
    throw new UsageError(
      `Access was not granted (${cb.error}): run mielikki gsc auth again and allow access`,
    );
  const code = cb.code ?? "";
  const secrets = [c.clientSecret, code, verifier];
  const res = await postToken(
    http_,
    c.tokenUri,
    {
      grant_type: "authorization_code",
      code,
      client_id: c.clientId,
      client_secret: c.clientSecret,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    },
    secrets,
  );
  if (res.status < 200 || res.status >= 300) {
    const e = googleError(res.text, secrets);
    throw new UsageError(
      `Google rejected the code exchange (HTTP ${res.status}${e ? `, ${e}` : ""})`,
    );
  }
  const t = parseTokens(res.text);
  if (!t.scope.includes(SCOPE))
    throw new UsageError(
      "Google did not grant webmasters.readonly: run mielikki gsc auth again and tick the Search Console access",
    );
  const broader = t.scope.filter((x) => x !== SCOPE && x !== "");
  if (broader.length > 0)
    io.warn?.(
      "Warning: Google granted more permissions than requested; mielikki only uses read access to Search Console.",
    );
  if (!t.refresh)
    throw new UsageError(
      "Google did not return a refresh token: run mielikki gsc auth again",
    );
  return {
    clientId: c.clientId,
    clientSecret: c.clientSecret,
    refreshToken: t.refresh,
    source: "oauth-client",
  };
}

export async function getAccessToken(
  t: StoredToken,
  http_: HttpJson,
  tokenUri: string = DEFAULT_TOKEN_URI,
): Promise<string> {
  return (await refreshAccess(t, http_, tokenUri)).access;
}

export async function refreshAccess(
  t: StoredToken,
  http_: HttpJson,
  tokenUri: string = DEFAULT_TOKEN_URI,
): Promise<{ access: string; scope: string[] }> {
  const secrets = [t.clientSecret ?? "", t.refreshToken];
  const res = await postToken(
    http_,
    tokenUri,
    {
      grant_type: "refresh_token",
      refresh_token: t.refreshToken,
      client_id: t.clientId,
      ...(t.clientSecret ? { client_secret: t.clientSecret } : {}),
    },
    secrets,
  );
  if (res.status < 200 || res.status >= 300) {
    const e = googleError(res.text, secrets);
    if (e === "invalid_grant")
      throw new UsageError(
        "Access was revoked or has expired: run mielikki gsc auth",
      );
    throw new UsageError(
      `Google rejected the token refresh (HTTP ${res.status}${e ? `, ${e}` : ""})`,
    );
  }
  const p = parseTokens(res.text);
  if (!p.access) throw new UsageError("Google did not return an access token");
  return { access: p.access, scope: p.scope };
}

/** Application Default Credentials: only `authorized_user` is accepted. */
export async function loadAdc(
  env: NodeJS.ProcessEnv,
  home: string,
): Promise<StoredToken | undefined> {
  const explicit = env.GOOGLE_APPLICATION_CREDENTIALS;
  const file =
    explicit && explicit !== ""
      ? explicit
      : path.join(
          home,
          ".config",
          "gcloud",
          "application_default_credentials.json",
        );
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch {
    if (explicit)
      throw new UsageError(
        "GOOGLE_APPLICATION_CREDENTIALS: the file is unreadable or not JSON",
      );
    return undefined;
  }
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  if (o.type !== "authorized_user")
    throw new UsageError(
      "ADC: only the authorized_user type is supported (gcloud auth application-default login); service accounts do not work",
    );
  if (typeof o.client_id !== "string" || typeof o.refresh_token !== "string")
    throw new UsageError("ADC: the file has no client_id/refresh_token");
  return {
    clientId: o.client_id,
    ...(typeof o.client_secret === "string"
      ? { clientSecret: o.client_secret }
      : {}),
    refreshToken: o.refresh_token,
    source: "adc",
  };
}
