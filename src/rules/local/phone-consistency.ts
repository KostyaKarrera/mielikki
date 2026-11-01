import { normalizePhone } from "../schema/_helpers.js";
import type { SiteRule } from "../types.js";

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export const rule: SiteRule = {
  meta: {
    id: "local/phone-consistency",
    title: "Different phone numbers in tel: links",
    category: "local",
    severity: "warning",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Use one phone number in every tel: link across the site.",
    source: "claude-seo:skills/seo-local/SKILL.md",
  },
  checkSite(ctx) {
    const phones = new Set<string>();
    for (const page of ctx.site.pages)
      for (const t of page.tel) {
        const n = normalizePhone(safeDecode(t));
        if (n.replace(/\D/g, "") !== "") phones.add(n);
      }
    if (phones.size < 2) return;
    const list = [...phones].sort();
    ctx.report({
      message: `${list.length} different phone numbers in tel: links: ${list.join(", ")}`,
      details: { phones: list },
    });
  },
};
