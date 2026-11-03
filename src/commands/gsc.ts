import os from "node:os";
import { UsageError } from "../errors.js";
import {
  defaultOpenUrl,
  loadAdc,
  readClientFile,
  runLoopbackLogin,
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

export async function runGscAuth(
  o: GscAuthOptions,
  io: GscIO,
  deps: GscDeps = {},
): Promise<number> {
  const warn = io.warn ?? (() => {});
  const file = tokenPath(io.env ?? process.env, io.home ?? os.homedir());
  try {
    if (o.logout) {
      await clearToken(file);
      io.write("Сохранённый доступ удалён.\n");
      return 0;
    }
    if (o.adc) {
      const t = await loadAdc(io.env ?? process.env, io.home ?? os.homedir());
      if (!t)
        throw new UsageError(
          "ADC не найдены: выполните gcloud auth application-default login или задайте GOOGLE_APPLICATION_CREDENTIALS",
        );
      await saveToken(file, t);
      io.write("Авторизовано (источник adc).\n");
      return 0;
    }
    if (o.client) {
      const c = await readClientFile(o.client);
      const http =
        deps.http ??
        createHttpJson({
          userAgent: `Mielikki/${VERSION} (+https://github.com/KostyaKarrera/mielikki)`,
          timeoutMs: 15000,
        });
      const t = await runLoopbackLogin(
        c,
        {
          openUrl: o.noOpen ? () => {} : (deps.openUrl ?? defaultOpenUrl),
          print: (s) => io.write(`${s}\n`),
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
