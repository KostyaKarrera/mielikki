import type { PageRule } from "../types.js";

export const rule: PageRule = {
  meta: {
    id: "a11y/form-label",
    title: "Form control has no label",
    category: "a11y",
    severity: "warning",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Give every form control a <label for>, a wrapping <label>, or an aria-label.",
    source: "mielikki:original",
  },
  checkPage(page, ctx) {
    const bad = page.formControls.filter((c) => !c.labelled);
    if (bad.length === 0) return;
    const sample = bad
      .slice(0, 3)
      .map((c) => (c.type !== undefined ? `${c.tag}[${c.type}]` : c.tag))
      .join(", ");
    ctx.report({
      message: `${bad.length} form control(s) without a label (${sample})`,
      details: { count: bad.length },
    });
  },
};
