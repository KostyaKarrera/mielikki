import type { PageRule } from "../types.js";

export const rule: PageRule = {
  meta: {
    id: "images/alt-missing",
    title: "Image has no alt attribute",
    category: "images",
    severity: "warning",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: 'Add alt text, or alt="" for purely decorative images.',
    source:
      "https://developers.google.com/search/docs/appearance/google-images",
  },
  checkPage(page, ctx) {
    for (const img of page.images)
      if (img.alt === null)
        ctx.report({ message: `Image "${img.src}" has no alt attribute` });
  },
};
