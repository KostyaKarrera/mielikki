import type { PageRule } from "../types.js";
import { internalImages } from "./_helpers.js";

const defaults = { warnKb: 500, infoKb: 200 };

export const rule: PageRule = {
  meta: {
    id: "images/weight",
    title: "Image file is heavy",
    category: "images",
    severity: "warning",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Compress or resize the image.",
    source: "https://web.dev/articles/use-imagemin-to-compress-images",
    defaultOptions: defaults,
  },
  checkPage(page, ctx) {
    const { warnKb, infoKb } = ctx.options(defaults);
    const seen = new Set<string>();
    for (const img of internalImages(page.images)) {
      const asset = ctx.site.assets.get(img.key);
      if (asset === undefined || seen.has(img.key)) continue;
      seen.add(img.key);
      const kb = Math.round(asset.bytes / 1024);
      if (asset.bytes > warnKb * 1024)
        ctx.report({
          message: `Image ${img.key} is ${kb} KB (max ${warnKb} KB)`,
          details: { bytes: asset.bytes },
        });
      else if (asset.bytes > infoKb * 1024)
        ctx.report({
          severity: "info",
          message: `Image ${img.key} is ${kb} KB (over ${infoKb} KB)`,
          details: { bytes: asset.bytes },
        });
    }
  },
};
