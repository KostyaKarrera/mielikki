import { NOT_FOUND_PROBE } from "../../load/probes.js";
import type { SiteRule } from "../types.js";

const PHRASES: Record<string, string[]> = {
  fi: ["ei löytynyt", "sivua ei löydy", "sivua ei löytynyt"],
  sv: ["hittades inte", "sidan hittades inte"],
  en: ["not found", "page not found"],
};

const normalise = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[\s.!?:;,…]+$/u, "")
    .trim();

/** True when a whole title segment / heading equals a not-found phrase or "404". */
export function isNotFoundText(
  text: string,
  language: string | undefined,
): boolean {
  const lists =
    language !== undefined && PHRASES[language] !== undefined
      ? [PHRASES[language] as string[]]
      : Object.values(PHRASES);
  const phrases = new Set(lists.flat());
  const candidates = [text, ...text.split(/[|–—-]/)].map(normalise);
  return candidates.some((c) => c === "404" || phrases.has(c));
}

export const rule: SiteRule = {
  meta: {
    id: "http/soft-404",
    title: "Missing pages answer 200 (soft 404)",
    category: "http",
    severity: "error",
    scope: "site",
    inputs: ["url"],
    launchBlocking: true,
    fix: "Make unknown URLs and 'not found' pages answer with status 404.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/http-network-errors#soft-404-errors",
  },
  checkSite(ctx) {
    const { site } = ctx;
    if (site.origin === undefined) return;
    const probeUrl = `${site.origin}${NOT_FOUND_PROBE}`;
    const probe = site.responses?.get(probeUrl)?.final;
    if (probe?.status === 200)
      ctx.report({
        url: probeUrl,
        message: "A nonexistent URL answers 200 instead of 404 (soft 404)",
      });
    for (const p of site.pages) {
      if (p.status !== 200) continue;
      const texts = [
        p.title,
        ...p.headings.filter((h) => h.level === 1).map((h) => h.text),
      ];
      const hit = texts.find(
        (t) => t !== undefined && isNotFoundText(t, ctx.config.language),
      );
      if (hit === undefined) continue;
      ctx.report({
        url: p.url ?? `${site.origin}${p.key}`,
        severity: "warning",
        message: `Page answers 200 but says "${hit.trim()}" (looks like a soft 404)`,
      });
    }
  },
};
