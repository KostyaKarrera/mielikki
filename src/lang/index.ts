import { en } from "./en.js";
import { fi } from "./fi.js";
import { other } from "./other.js";
import { sv } from "./sv.js";
import type { LangModule } from "./types.js";

const modules: Record<string, LangModule> = { fi, sv, en };

/** 'fi-FI' -> fi; unknown or missing -> other. */
export function getLang(code?: string): LangModule {
  const base = code?.toLowerCase().split(/[-_]/)[0] ?? "";
  return modules[base] ?? other;
}

export type { LangModule } from "./types.js";
