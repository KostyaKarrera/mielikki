import type { PageRule } from "../types.js";
import { internalImages } from "./_helpers.js";

const defaults = { minKb: 50 };
const LEGACY = new Set(["jpg", "jpeg", "png"]);

export const rule: PageRule = {
  meta: {
    id: "images/modern-format",
    title: "Image could use a modern format",
    category: "images",
    severity: "info",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Serve large JPEG/PNG images as WebP or AVIF.",
    source: "https://web.dev/articles/serve-images-webp",
    defaultOptions: defaults,
  },
  checkPage(page, ctx) {
    const { minKb } = ctx.options(defaults);
    const seen = new Set<string>();
    for (const img of internalImages(page.images)) {
      const asset = ctx.site.assets.get(img.key);
      if (
        asset === undefined ||
        seen.has(img.key) ||
        !LEGACY.has(asset.ext) ||
        asset.bytes <= minKb * 1024
      )
        continue;
      seen.add(img.key);
      ctx.report({
        message: `Image ${img.key} is ${Math.round(asset.bytes / 1024)} KB .${asset.ext}; consider WebP or AVIF`,
      });
    }
  },
};
