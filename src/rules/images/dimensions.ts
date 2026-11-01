import type { PageRule } from "../types.js";

export const rule: PageRule = {
  meta: {
    id: "images/dimensions",
    title: "Image has no width or height",
    category: "images",
    severity: "info",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Set width and height attributes to avoid layout shift.",
    source: "https://web.dev/articles/optimize-cls",
  },
  checkPage(page, ctx) {
    for (const img of page.images) {
      const missing = [
        ...(img.width === undefined || img.width.trim() === ""
          ? ["width"]
          : []),
        ...(img.height === undefined || img.height.trim() === ""
          ? ["height"]
          : []),
      ];
      if (missing.length > 0)
        ctx.report({
          message: `Image "${img.src}" has no ${missing.join(" or ")}`,
        });
    }
  },
};
