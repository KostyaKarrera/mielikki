import { randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { UsageError } from "../errors.js";

export interface StoredToken {
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  source: "oauth-client" | "adc";
}

/** Dir 0700, file 0600, written to a private temp file and renamed into place. */
export async function saveToken(file: string, t: StoredToken): Promise<void> {
  const dir = path.dirname(file);
  const st = await lstat(dir).catch(() => undefined);
  if (st?.isSymbolicLink()) throw new UsageError("token dir is a symlink");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const tmp = path.join(
    dir,
    `.gsc-token.${randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    await writeFile(tmp, `${JSON.stringify(t, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

export async function loadToken(
  file: string,
): Promise<StoredToken | undefined> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.clientId !== "string" ||
    typeof o.refreshToken !== "string" ||
    (o.source !== "oauth-client" && o.source !== "adc") ||
    (o.clientSecret !== undefined && typeof o.clientSecret !== "string")
  )
    return undefined;
  return {
    clientId: o.clientId,
    ...(o.clientSecret !== undefined ? { clientSecret: o.clientSecret } : {}),
    refreshToken: o.refreshToken,
    source: o.source,
  };
}

export async function clearToken(file: string): Promise<void> {
  await rm(file, { force: true });
}
