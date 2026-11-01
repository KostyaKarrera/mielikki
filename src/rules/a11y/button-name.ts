import type { PageRule } from "../types.js";

export const rule: PageRule = {
  meta: {
    id: "a11y/button-name",
    title: "Button has no accessible name",
    category: "a11y",
    severity: "warning",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Give every button visible text or an aria-label.",
    source: "mielikki:original",
  },
  checkPage(page, ctx) {
    const count = page.buttons.filter((b) => !b.named).length;
    if (count > 0)
      ctx.report({
        message: `${count} button(s) without an accessible name`,
        details: { count },
      });
  },
};
