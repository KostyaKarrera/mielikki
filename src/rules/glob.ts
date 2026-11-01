import { pageKey } from "../model/url.js";

function escapeRe(s: string): string {
  return s.replace(/[.+^${}()|[\]\\?]/g, "\\$&");
}

/** Rule-id glob: `*` stays within a segment (no `/`), `**` crosses `/`. */
export function matchGlob(pattern: string, value: string): boolean {
  const re = pattern
    .split("**")
    .map((part) => part.split("*").map(escapeRe).join("[^/]*"))
    .join(".*");
  return new RegExp(`^${re}$`).test(value);
}

/**
 * Page-key glob: `*` crosses `/`. A trailing `/*` also matches the directory
 * key itself. A pattern without `*` is compared as a normalized page key.
 */
export function matchPath(pattern: string, key: string): boolean {
  if (!pattern.includes("*")) return pageKey(pattern) === pageKey(key);
  if (pattern.endsWith("/*") && !pattern.slice(0, -1).includes("*")) {
    const prefix = pattern.slice(0, -1);
    return key === prefix || key.startsWith(prefix);
  }
  const re = pattern.split("*").map(escapeRe).join(".*");
  return new RegExp(`^${re}$`).test(key);
}
