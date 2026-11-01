import { isIndexable } from "../../model/indexable.js";
import { matchPath } from "../glob.js";
import type { PageRule } from "../types.js";

const DEFAULTS = { minWords: 250, minWordsRequired: 400 };

export const rule: PageRule = {
  meta: {
    id: "content/word-count",
    title: "Page has little text",
    category: "content",
    severity: "info",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Add useful, specific content for visitors; target pages need more depth.",
    source: "mielikki:original",
    defaultOptions: DEFAULTS,
  },
  checkPage(page, ctx) {
    if (!isIndexable(ctx.site, page)) return;
    const o = ctx.options(DEFAULTS);
    const required = ctx.config.targets.required.some((p) =>
      matchPath(p, page.key),
    );
    const min = required ? o.minWordsRequired : o.minWords;
    if (page.wordCount < min)
      ctx.report({
        message: `${page.key} has ${page.wordCount} words (min ${min})`,
        details: { wordCount: page.wordCount, min },
      });
  },
};
