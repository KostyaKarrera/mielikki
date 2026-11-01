import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type Config, parseConfig } from "../src/config/schema.js";
import { loadDir } from "../src/load/dir.js";
import type { Page, Site } from "../src/model/types.js";
import { parsePage } from "../src/parse/page.js";

export function pageFrom(html: string, key = "/"): Page {
  return parsePage(html, key);
}

/** Writes files (relative path -> content) to a temp dir, loads it, removes the dir. */
export async function siteFrom(
  files: Record<string, string | Buffer>,
  config: Partial<Config> = {},
): Promise<Site> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mielikki-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(dir, rel);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content);
    }
    return await loadDir(dir, parseConfig(config));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
