import type { PageRule } from "../types.js";

export const rule: PageRule = {
  meta: {
    id: "images/lazy-above-fold",
    title: "First content image is lazy-loaded",
    category: "images",
    severity: "info",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: 'Remove loading="lazy" from the first image in the main content.',
    source: "https://web.dev/articles/browser-level-image-lazy-loading",
  },
  checkPage(page, ctx) {
    const img = page.images.find((i) => i.index === 0 && i.inMain);
    if (img !== undefined && img.loading?.trim().toLowerCase() === "lazy")
      ctx.report({
        message: `First image "${img.src}" in main content has loading="lazy"`,
      });
  },
};
