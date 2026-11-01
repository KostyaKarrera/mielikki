import type { PageRule } from "../types.js";
import { targetKey } from "./_helpers.js";

const MAX_SHARE = 0.04;
const MIN_COUNT = 8;

export const rule: PageRule = {
  meta: {
    id: "content/keyword-stuffing",
    title: "Possible keyword stuffing",
    category: "content",
    severity: "warning",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Write naturally and use the keyword and its variants less often.",
    source:
      "https://developers.google.com/search/docs/essentials/spam-policies#keyword-stuffing",
  },
  checkPage(page, ctx) {
    const targets = ctx.config.targets.pages.filter(
      (t) => targetKey(t.url) === page.key,
    );
    if (targets.length === 0) return;
    const tokens = ctx.lang.tokenize(page.mainText);
    if (tokens.length === 0) return;
    const counts = new Map<string, number>();
    for (const t of tokens) {
      const s = ctx.lang.stem(t);
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    const stems = new Set<string>();
    for (const t of targets)
      for (const w of ctx.lang.tokenize(t.primary))
        if (!ctx.lang.stopwords.has(w)) stems.add(ctx.lang.stem(w));
    for (const stem of [...stems].sort()) {
      const n = counts.get(stem) ?? 0;
      const share = n / tokens.length;
      if (n >= MIN_COUNT && share > MAX_SHARE)
        ctx.report({
          message: `"${stem}" appears ${n} times (${(share * 100).toFixed(1)}% of ${tokens.length} words, max ${MAX_SHARE * 100}%)`,
          details: { stem, count: n, share },
        });
    }
  },
};
