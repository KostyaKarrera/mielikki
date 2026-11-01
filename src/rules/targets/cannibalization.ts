import { stemsMatch } from "../../lang/match.js";
import type { SiteRule } from "../types.js";
import { resolveTargets } from "./_helpers.js";

/** One-to-one pairing of stems under stemsMatch, ignoring order. */
function sameStems(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const rest = [...b];
  for (const s of a) {
    const i = rest.findIndex((t) => stemsMatch(s, t));
    if (i < 0) return false;
    rest.splice(i, 1);
  }
  return true;
}

export const rule: SiteRule = {
  meta: {
    id: "targets/cannibalization",
    title: "Two pages target the same query",
    category: "targets",
    severity: "error",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: true,
    fix: "Give each page its own primary query or merge the pages.",
    source: "mielikki:original",
  },
  checkSite(ctx) {
    const { lang } = ctx;
    const items = resolveTargets(ctx)
      .map(({ target, key }) => ({
        key,
        primary: target.primary,
        stems: lang
          .tokenize(target.primary)
          .filter((t) => !lang.stopwords.has(t))
          .map((t) => lang.stem(t)),
      }))
      .filter((i) => i.stems.length > 0)
      .sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        if (!a || !b || a.key === b.key) continue;
        if (sameStems(a.stems, b.stems))
          ctx.report({
            url: a.key,
            message: `Targets of ${a.key} ("${a.primary}") and ${b.key} ("${b.primary}") compete for the same query`,
            details: { other: b.key },
          });
      }
  },
};
