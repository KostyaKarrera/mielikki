import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse, YAMLParseError } from "yaml";
import { type Config, ConfigError, parseConfig } from "./schema.js";

const DEFAULT_NAMES = ["mielikki.config.yaml", "mielikki.config.yml"];

async function readIfExists(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new ConfigError(`Cannot read ${file}: ${(e as Error).message}`, "");
  }
}

/** Loads mielikki.config.yaml|yml from cwd (or explicitPath); no file → defaults. */
export async function loadConfig(
  cwd: string,
  explicitPath?: string,
): Promise<Config> {
  const candidates = explicitPath
    ? [resolve(cwd, explicitPath)]
    : DEFAULT_NAMES.map((n) => resolve(cwd, n));
  for (const file of candidates) {
    const text = await readIfExists(file);
    if (text === undefined) {
      if (explicitPath)
        throw new ConfigError(`Config file not found: ${file}`, "");
      continue;
    }
    let raw: unknown;
    try {
      raw = parse(text);
    } catch (e) {
      if (e instanceof YAMLParseError) {
        const line = e.linePos?.[0].line;
        throw new ConfigError(
          `Invalid YAML in ${file}${line ? ` at line ${line}` : ""}: ${e.message.split("\n")[0]}`,
          "",
        );
      }
      throw e;
    }
    return parseConfig(raw);
  }
  return parseConfig({});
}
