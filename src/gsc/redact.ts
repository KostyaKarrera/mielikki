const MIN_SECRET = 6;

/** Replaces every occurrence of each secret (also URL-encoded) with `[redacted]`. */
export function redact(text: string, secrets: string[]): string {
  const variants = new Set<string>();
  for (const s of secrets) {
    if (typeof s !== "string" || s.length < MIN_SECRET) continue;
    variants.add(s);
    variants.add(encodeURIComponent(s));
    variants.add(JSON.stringify(s).slice(1, -1));
  }
  let out = text;
  for (const v of [...variants].sort((a, b) => b.length - a.length)) {
    out = out.split(v).join("[redacted]");
  }
  return out;
}
