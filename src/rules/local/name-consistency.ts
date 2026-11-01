import type { SiteRule } from "../types.js";

const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

export const rule: SiteRule = {
  meta: {
    id: "local/name-consistency",
    title: "Business name not found in page text",
    category: "local",
    severity: "info",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Use the business name exactly as configured in page text or titles (header, footer, contact page).",
    source: "claude-seo:skills/seo-local/SKILL.md",
  },
  checkSite(ctx) {
    const name = ctx.config.business?.name;
    if (name === undefined || norm(name) === "") return;
    const needle = norm(name);
    const found = ctx.site.pages.some(
      (p) =>
        norm(p.mainText).includes(needle) ||
        norm(p.title ?? "").includes(needle),
    );
    if (!found)
      ctx.report({
        message: `Business name "${name}" does not occur in the text or title of any page`,
        details: { name },
      });
  },
};
