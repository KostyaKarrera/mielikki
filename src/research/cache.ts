import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface DiskCache {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

export const nullCache: DiskCache = {
  async get() {
    return undefined;
  },
  async set() {},
};

export function createDiskCache(
  dir: string,
  ttlMs: number,
  now: () => number = Date.now,
): DiskCache {
  const fileFor = (key: string): string =>
    join(dir, `${createHash("sha256").update(key).digest("hex")}.json`);
  return {
    async get(key) {
      try {
        const parsed: unknown = JSON.parse(
          await readFile(fileFor(key), "utf8"),
        );
        if (typeof parsed !== "object" || parsed === null) return undefined;
        const { at, value } = parsed as { at?: unknown; value?: unknown };
        if (typeof at !== "number" || typeof value !== "string") {
          return undefined;
        }
        if (now() - at > ttlMs) return undefined;
        return value;
      } catch {
        return undefined;
      }
    },
    async set(key, value) {
      try {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        await writeFile(fileFor(key), JSON.stringify({ at: now(), value }), {
          mode: 0o600,
        });
      } catch {
        // cache is best-effort: a write failure must not fail the command
      }
    },
  };
}
