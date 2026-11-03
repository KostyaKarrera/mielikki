import type { Config } from "../config/schema.js";
import type { LangModule } from "../lang/index.js";
import { stemsMatch } from "../lang/match.js";
import type { QueryRow } from "./api.js";

export interface TargetCoverage {
  target: string;
  primary: string;
  matched: QueryRow[];
  impressions: number;
  clicks: number;
  bestPosition: number | null;
  /** Distinct pages (not the target) that received matched queries, sorted, top 3. */
  otherPages: string[];
  status: "no-data" | "ranking" | "other-page";
}

/** Comparable page identity: host (only if absolute), path without trailing slash/index.html. */
function pageKey(u: string): { host?: string; path: string } {
  const absolute = /^https?:\/\//i.test(u);
  let url: URL;
  try {
    url = new URL(u, "https://placeholder.invalid");
  } catch {
    return { path: u };
  }
  let p = url.pathname.replace(/\/index\.html?$/i, "/");
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return { ...(absolute ? { host: url.host.toLowerCase() } : {}), path: p };
}

function samePage(a: string, b: string): boolean {
  const x = pageKey(a);
  const y = pageKey(b);
  if (x.host !== undefined && y.host !== undefined && x.host !== y.host)
    return false;
  return x.path === y.path;
}

/**
 * A query belongs to a target when every stem of the target's `primary`
 * phrase occurs (equal or near-equal, as in `stemsMatch`) among the stems of the query's tokens (order and case
 * endings do not matter). `forms` of the target page count as extra forms.
 */
export function matchQueriesToTargets(
  rows: QueryRow[],
  config: Config,
  lang: LangModule,
): TargetCoverage[] {
  return config.targets.pages.map((page) => {
    const need = lang
      .tokenize(page.primary)
      .filter((t) => !lang.stopwords.has(t))
      .map((t) => ({
        token: t,
        stem: lang.stem(t),
        forms: new Set(
          Object.entries(page.forms)
            .filter(([k]) => k.normalize("NFC").toLowerCase() === t)
            .flatMap(([, v]) => v)
            .map((f) => f.normalize("NFC").toLowerCase()),
        ),
      }));
    const matched =
      need.length === 0
        ? []
        : rows.filter((r) => {
            const tokens = lang.tokenize(r.query);
            const stems = tokens.map((t) => lang.stem(t));
            const set = new Set(tokens);
            return need.every(
              (n) =>
                stems.some((s) => stemsMatch(n.stem, s)) ||
                [...n.forms].some((f) => set.has(f)),
            );
          });
    matched.sort(
      (a, b) =>
        b.impressions - a.impressions ||
        (a.query < b.query ? -1 : a.query > b.query ? 1 : 0) ||
        (a.page < b.page ? -1 : a.page > b.page ? 1 : 0),
    );
    return {
      target: page.url,
      primary: page.primary,
      matched,
      impressions: matched.reduce((s, r) => s + r.impressions, 0),
      clicks: matched.reduce((s, r) => s + r.clicks, 0),
      bestPosition: matched.length
        ? Math.min(...matched.map((r) => r.position))
        : null,
      otherPages: [
        ...new Set(
          matched.filter((r) => !samePage(r.page, page.url)).map((r) => r.page),
        ),
      ]
        .sort()
        .slice(0, 3),
      status:
        matched.length === 0
          ? "no-data"
          : matched.some((r) => samePage(r.page, page.url))
            ? "ranking"
            : "other-page",
    };
  });
}
