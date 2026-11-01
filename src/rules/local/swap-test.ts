import { stemsMatch } from "../../lang/match.js";
import { matchPath } from "../glob.js";
import type { SiteRule } from "../types.js";

const SHINGLE = 5;
const MIN_TOKENS = 40;
const THRESHOLD = 0.6;
const defaults = { pages: ["/alueet/*"] };

function jaccard(a: Set<string>, b: Set<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const s of small) if (large.has(s)) inter++;
  return inter / (a.size + b.size - inter);
}

export const rule: SiteRule = {
  meta: {
    id: "local/swap-test",
    title: "Area pages differ only by the city name",
    category: "local",
    severity: "warning",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Rewrite each area page with locally specific content (projects, streets, services), not a template with the city swapped.",
    source: "claude-seo:skills/seo-local/SKILL.md",
    defaultOptions: defaults,
  },
  checkSite(ctx) {
    const areas = ctx.config.business?.areaServed ?? [];
    if (areas.length === 0) return;
    const { pages: masks } = ctx.options(defaults);
    const lang = ctx.lang;
    // Each areaServed entry is a token sequence (stems); longest first.
    const cityPhrases = areas
      .map((a) => lang.tokenize(a).map((t) => lang.stem(t)))
      .filter((p) => p.length > 0)
      .sort((x, y) => y.length - x.length);
    const explicit = new Set<string>();
    for (const tp of ctx.config.targets.pages)
      for (const [key, forms] of Object.entries(tp.forms)) {
        const ks = lang.stem(key.normalize("NFC").toLowerCase());
        if (
          !cityPhrases.some((p) => p.length === 1 && stemsMatch(p[0] ?? "", ks))
        )
          continue;
        for (const f of forms)
          for (const t of lang.tokenize(f)) explicit.add(t);
      }
    const swap = (tokens: string[]): string[] => {
      const stems = tokens.map((t) => lang.stem(t));
      const out: string[] = [];
      for (let i = 0; i < tokens.length; ) {
        const phrase = cityPhrases.find(
          (p) =>
            i + p.length <= tokens.length &&
            p.every((c, k) => stemsMatch(c, stems[i + k] ?? "")),
        );
        if (phrase !== undefined) {
          out.push("{CITY}");
          i += phrase.length;
        } else if (explicit.has(tokens[i] ?? "")) {
          out.push("{CITY}");
          i++;
        } else {
          out.push(tokens[i] ?? "");
          i++;
        }
      }
      return out;
    };

    const items: { key: string; shingles: Set<string> }[] = [];
    for (const page of ctx.site.pages) {
      if (!masks.some((m) => matchPath(m, page.key))) continue;
      const tokens = swap(lang.tokenize(page.mainText));
      if (tokens.length < MIN_TOKENS) continue;
      const shingles = new Set<string>();
      for (let i = 0; i + SHINGLE <= tokens.length; i++)
        shingles.add(tokens.slice(i, i + SHINGLE).join(" "));
      items.push({ key: page.key, shingles });
    }
    items.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        if (!a || !b) continue;
        const sim = jaccard(a.shingles, b.shingles);
        if (sim >= THRESHOLD)
          ctx.report({
            url: a.key,
            message: `${a.key} matches ${b.key} once city names are swapped out (similarity ${Math.round(sim * 100)}%)`,
            details: { other: b.key, similarity: sim },
          });
      }
  },
};
