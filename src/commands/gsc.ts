import os from "node:os";
import { UsageError } from "../errors.js";
import {
  DEFAULT_TOKEN_URI,
  defaultOpenUrl,
  loadAdc,
  readClientFile,
  refreshAccess,
  runLoopbackLogin,
  SCOPE,
} from "../gsc/oauth.js";
import { tokenPath } from "../gsc/paths.js";
import { clearToken, loadToken, saveToken } from "../gsc/token-store.js";
import { createHttpJson, type HttpJson } from "../research/http.js";
import { VERSION } from "../version.js";

export interface GscIO {
  write(s: string): void;
  warn?(s: string): void;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

export interface GscAuthOptions {
  client?: string;
  adc: boolean;
  logout: boolean;
  noOpen: boolean;
}

/** Test seams only; the CLI never sets these. */
export interface GscDeps {
  http?: HttpJson;
  openUrl?: (url: string) => void;
  /** Fake endpoints for tests; the CLI never sets these. */
  authUri?: string;
  tokenUri?: string;
  timeoutMs?: number;
}

const HELP = [
  "Нет сохранённого доступа к Search Console. Варианты:",
  "  1. mielikki gsc auth --client client.json — OAuth-клиент типа «Desktop app»",
  "     (Google Cloud Console: APIs & Services, включить Search Console API,",
  "     Credentials, Create OAuth client ID, Desktop app, скачать JSON).",
  "  2. mielikki gsc auth --adc — Application Default Credentials",
  "     (gcloud auth application-default login с scope webmasters.readonly).",
  "Подробнее: docs/gsc.md.",
].join("\n");

const defaultHttp = (): HttpJson =>
  createHttpJson({
    userAgent: `Mielikki/${VERSION} (+https://github.com/KostyaKarrera/mielikki)`,
    timeoutMs: 15000,
  });

export async function runGscAuth(
  o: GscAuthOptions,
  io: GscIO,
  deps: GscDeps = {},
): Promise<number> {
  const warn = io.warn ?? (() => {});
  const file = tokenPath(io.env ?? process.env, io.home ?? os.homedir());
  try {
    if (o.adc && o.client)
      throw new UsageError("Укажите либо --adc, либо --client, не оба сразу");
    if (o.logout) {
      const had = await loadToken(file);
      await clearToken(file);
      io.write(
        `Локальный токен удалён (или его не было); доступ остаётся выдан, пока вы не отзовёте его на myaccount.google.com/permissions.${
          had?.source === "adc"
            ? " Собственная копия gcloud (ADC) не затронута."
            : ""
        }\n`,
      );
      return 0;
    }
    if (o.adc) {
      const t = await loadAdc(io.env ?? process.env, io.home ?? os.homedir());
      if (!t)
        throw new UsageError(
          "ADC не найдены: выполните gcloud auth application-default login или задайте GOOGLE_APPLICATION_CREDENTIALS",
        );
      const http = deps.http ?? defaultHttp();
      const r = await refreshAccess(
        t,
        http,
        deps.tokenUri ?? DEFAULT_TOKEN_URI,
      );
      if (!r.scope.includes(SCOPE))
        throw new UsageError(
          `В ADC нет доступа webmasters.readonly: gcloud auth application-default login --scopes=${SCOPE},https://www.googleapis.com/auth/cloud-platform`,
        );
      await saveToken(file, t);
      io.write("Авторизовано (источник adc).\n");
      return 0;
    }
    if (o.client) {
      const c = await readClientFile(o.client);
      if (deps.authUri) c.authUri = deps.authUri;
      if (deps.tokenUri) c.tokenUri = deps.tokenUri;
      const http = deps.http ?? defaultHttp();
      const t = await runLoopbackLogin(
        c,
        {
          openUrl: o.noOpen ? () => {} : (deps.openUrl ?? defaultOpenUrl),
          print: (s) => io.write(`${s}\n`),
          warn,
          timeoutMs: deps.timeoutMs ?? 300_000,
        },
        http,
      );
      await saveToken(file, t);
      io.write("Авторизовано (источник oauth-client).\n");
      return 0;
    }
    const existing = await loadToken(file);
    if (existing) {
      io.write(`Уже авторизовано (источник ${existing.source}).\n`);
      return 0;
    }
    warn(HELP);
    return 2;
  } catch (err) {
    if (err instanceof UsageError) {
      warn(`mielikki: ${err.message.split("\n")[0]}`);
      return 2;
    }
    warn("mielikki: не удалось выполнить gsc auth");
    return 2;
  }
}
