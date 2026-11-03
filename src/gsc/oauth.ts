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
  "создайте в Google Cloud Console OAuth-клиент типа «Desktop app» и скачайте его JSON";

function safeUri(v: unknown, fallback: string): string {
  const s = typeof v === "string" && v !== "" ? v : fallback;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new UsageError(
      `Файл клиента: некорректный адрес OAuth; ${DESKTOP_HINT}`,
    );
  }
  const loopback = u.hostname === "127.0.0.1" || u.hostname === "localhost";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback))
    throw new UsageError("Файл клиента: адрес OAuth должен быть https");
  return s;
}

/** Google "Desktop app" client file: {"installed": {...}}. Never echoes file content. */
export async function readClientFile(file: string): Promise<ClientSecrets> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new UsageError(
      `Не удалось прочитать файл клиента как JSON; ${DESKTOP_HINT}`,
    );
  }
  const inst =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>).installed
      : undefined;
  if (typeof inst !== "object" || inst === null)
    throw new UsageError(
      `Файл клиента не в формате «Desktop app»; ${DESKTOP_HINT}`,
    );
  const i = inst as Record<string, unknown>;
  if (typeof i.client_id !== "string" || typeof i.client_secret !== "string")
    throw new UsageError(
      `В файле клиента нет client_id/client_secret («Desktop app»); ${DESKTOP_HINT}`,
    );
  return {
    clientId: i.client_id,
    clientSecret: i.client_secret,
    authUri: safeUri(i.auth_uri, DEFAULT_AUTH_URI),
    tokenUri: safeUri(i.token_uri, DEFAULT_TOKEN_URI),
  };
}

export interface LoginIO {
  openUrl(url: string): void;
  print(s: string): void;
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
      redact(`Не удалось связаться с Google (${m.slice(0, 80)})`, secrets),
    );
  }
}

function parseTokens(text: string): { refresh?: string; access?: string } {
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    return {
      refresh:
        typeof o.refresh_token === "string" ? o.refresh_token : undefined,
      access: typeof o.access_token === "string" ? o.access_token : undefined,
    };
  } catch {
    return {};
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
        return reply(400, "Неверный state: запрос отклонён.");
      const error = u.searchParams.get("error");
      const code = u.searchParams.get("code");
      if (!error && !code) return reply(400, "Нет кода авторизации.");
      reply(200, "Готово. Можно закрыть вкладку и вернуться в терминал.");
      finish(() =>
        resolve(
          error
            ? { error: /^[a-z_]{1,40}$/.test(error) ? error : "unknown" }
            : { code: code ?? undefined },
        ),
      );
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
        reject(
          new UsageError("Не удалось запустить локальный сервер для входа"),
        ),
      ),
    );
    server.listen(0, "127.0.0.1", () => {
      timer = setTimeout(
        () =>
          finish(() =>
            reject(
              new UsageError(
                "Время ожидания входа истекло: повторите mielikki gsc auth",
              ),
            ),
          ),
        timeoutMs,
      );
      onListening((server.address() as AddressInfo).port);
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
    io.print(
      `Откройте ссылку в браузере и разрешите доступ:\n${url.toString()}`,
    );
    io.openUrl(url.toString());
  });
  if (cb.error)
    throw new UsageError(
      `Доступ не выдан (${cb.error}): повторите mielikki gsc auth и разрешите доступ`,
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
      `Google отклонил обмен кода (HTTP ${res.status}${e ? `, ${e}` : ""})`,
    );
  }
  const t = parseTokens(res.text);
  if (!t.refresh)
    throw new UsageError(
      "Google не вернул refresh-токен: повторите mielikki gsc auth",
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
        "Доступ отозван или истёк: выполните mielikki gsc auth",
      );
    throw new UsageError(
      `Google отклонил обновление токена (HTTP ${res.status}${e ? `, ${e}` : ""})`,
    );
  }
  const a = parseTokens(res.text).access;
  if (!a) throw new UsageError("Google не вернул access-токен");
  return a;
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
        "GOOGLE_APPLICATION_CREDENTIALS: файл не читается или не JSON",
      );
    return undefined;
  }
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  if (o.type !== "authorized_user")
    throw new UsageError(
      "ADC: поддерживается только тип authorized_user (gcloud auth application-default login); сервисные аккаунты не подходят",
    );
  if (typeof o.client_id !== "string" || typeof o.refresh_token !== "string")
    throw new UsageError("ADC: в файле нет client_id/refresh_token");
  return {
    clientId: o.client_id,
    ...(typeof o.client_secret === "string"
      ? { clientSecret: o.client_secret }
      : {}),
    refreshToken: o.refresh_token,
    source: "adc",
  };
}
