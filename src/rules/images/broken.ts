import { isCrawled, keyUrl, reachOfUrls } from "../_reach.js";
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
    const { site } = ctx;
    const seen = new Set<string>();
    for (const img of internalImages(page.images)) {
      if (site.assets.has(img.key) || seen.has(img.key)) continue;
      let why = "does not exist";
      if (isCrawled(site)) {
        // URL mode: an image over the asset budget was not requested (unknown);
        // one that redirects (e.g. to a CDN) is not broken.
        const reach = reachOfUrls(site, [keyUrl(site.origin, img.key)]);
        if (reach.state !== "broken") continue;
        why = reach.reason;
      }
      seen.add(img.key);
      ctx.report({ message: `Image "${img.src}" (${img.key}) ${why}` });
    }
  },
};
