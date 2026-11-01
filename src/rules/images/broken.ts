import type { PageRule } from "../types.js";
import { internalImages } from "./_helpers.js";

export const rule: PageRule = {
  meta: {
    id: "images/broken",
    title: "Image file is missing",
    category: "images",
    severity: "error",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: true,
    fix: "Fix the image path or add the missing file.",
    source: "squirrelscan:images/broken-images",
  },
  checkPage(page, ctx) {
    const seen = new Set<string>();
    for (const img of internalImages(page.images)) {
      if (ctx.site.assets.has(img.key) || seen.has(img.key)) continue;
      seen.add(img.key);
      ctx.report({ message: `Image "${img.src}" (${img.key}) does not exist` });
    }
  },
};
