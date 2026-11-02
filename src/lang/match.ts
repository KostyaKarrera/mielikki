import type { LangModule } from "./types.js";

export type MatchLevel = "full" | "partial" | "none";

const MIN_COMPOUND_STEM = 4;

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** Equal, or (both stems >= 6 chars) common prefix >= max(5, min(len) - 2). */
export function stemsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 6 || b.length < 6) return false;
  return commonPrefix(a, b) >= Math.max(5, Math.min(a.length, b.length) - 2);
}

export function phraseIn(
  phrase: string,
  text: string,
  lang: LangModule,
  forms?: Record<string, string[]>,
): MatchLevel {
  const tokens = lang.tokenize(phrase).filter((t) => !lang.stopwords.has(t));
  if (tokens.length === 0) return "none";
  // forms keys are matched against tokenized (NFC, lowercase) phrase words
  const formsByToken = new Map<string, string[]>();
  for (const [k, v] of Object.entries(forms ?? {})) {
    const key = k.normalize("NFC").toLowerCase();
    formsByToken.set(key, [...(formsByToken.get(key) ?? []), ...v]);
  }
  const textTokens = lang.tokenize(text);
  const textStems = textTokens.map((t) => lang.stem(t));
  let matches = 0;
  let misses = 0;
  for (const token of tokens) {
    const stem = lang.stem(token);
    const explicit = new Set(
      (formsByToken.get(token) ?? []).map((f) =>
        f.normalize("NFC").toLowerCase(),
      ),
    );
    const matched =
      textStems.some((s) => stemsMatch(stem, s)) ||
      textTokens.some((t) => explicit.has(t));
    if (matched) {
      matches++;
    } else if (
      // compound check (stem inside a longer word) only for stems of >= 4 chars
      stem.length < MIN_COMPOUND_STEM ||
      !textStems.some(
        (s) => s.length >= 5 && (s.endsWith(stem) || s.startsWith(stem)),
      )
    ) {
      misses++;
    }
  }
  if (matches === tokens.length) return "full";
  if (misses === 0) return "partial";
  return misses / tokens.length <= 0.5 ? "partial" : "none";
}
