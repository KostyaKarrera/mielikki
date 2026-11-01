import type { PageRule } from "../types.js";

export const rule: PageRule = {
  meta: {
    id: "mobile/zoom-disabled",
    title: "Viewport disables zooming",
    category: "mobile",
    severity: "warning",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Remove user-scalable=no and allow maximum-scale of at least 2.",
    source:
      "https://developer.chrome.com/docs/lighthouse/accessibility/meta-viewport",
  },
  checkPage(page, ctx) {
    if (!page.viewport) return;
    const props = new Map<string, string>();
    for (const part of page.viewport.split(/[,;]/)) {
      const [k, v] = part.split("=");
      if (v !== undefined)
        props.set(k.trim().toLowerCase(), v.trim().toLowerCase());
    }
    const scalable = props.get("user-scalable");
    const maxScale = Number.parseFloat(props.get("maximum-scale") ?? "");
    if (scalable === "no" || scalable === "0")
      ctx.report({ message: `Viewport sets user-scalable=${scalable}` });
    else if (Number.isFinite(maxScale) && maxScale < 2)
      ctx.report({
        message: `Viewport sets maximum-scale=${maxScale} (min 2)`,
      });
  },
};
