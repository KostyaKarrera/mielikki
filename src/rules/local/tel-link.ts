import { load } from "cheerio";
import { normalizePhone } from "../schema/_helpers.js";
import type { PageRule } from "../types.js";

const digits = (s: string): string => s.replace(/\D/g, "");

export const rule: PageRule = {
  meta: {
    id: "local/tel-link",
    title: "Phone number is not a tel: link",
    category: "local",
    severity: "warning",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: 'Wrap the phone number in <a href="tel:+358...">.',
    source: "claude-seo:skills/seo-local/SKILL.md",
  },
  checkPage(page, ctx) {
    const phone = ctx.config.business?.phone;
    if (phone === undefined || page.tel.length > 0) return;
    const want = digits(normalizePhone(phone));
    if (want === "") return;
    const $ = load(page.html);
    $("script, style, noscript, template").remove();
    const hay = [$("body").text(), ...page.links.map((l) => l.text)].map(
      digits,
    );
    if (hay.some((h) => h.includes(want)))
      ctx.report({
        message: `Phone ${phone} appears as text on ${page.key} but the page has no tel: link`,
      });
  },
};
