import type { PageRule } from "../types.js";

const PHONE_RE = /\+?\d[\d\s().-]{5,}\d/g;
const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu;

function compileAll(patterns: readonly string[]): RegExp[] {
  const out: RegExp[] = [];
  for (const p of patterns) {
    try {
      out.push(new RegExp(p, "iu"));
    } catch {
      // invalid pattern: skipped
    }
  }
  return out;
}

/** Digits only; a leading 00 becomes +. */
function normalizePhone(v: string): string {
  const digits = v.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  const d = digits.replace(/^\+/, "");
  return digits.startsWith("+")
    ? `+${d}`
    : d.startsWith("00")
      ? `+${d.slice(2)}`
      : d;
}

export const rule: PageRule = {
  meta: {
    id: "content/test-contact",
    title: "Test or wrong contact details",
    category: "content",
    severity: "error",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: true,
    fix: "Replace test phone numbers and emails with the real business contacts.",
    source: "mielikki:original",
  },
  checkPage(page, ctx) {
    const phonePatterns = compileAll(ctx.config.testContacts.phones);
    const emailPatterns = compileAll(ctx.config.testContacts.emails);
    const isTestPhone = (v: string) => {
      const compact = v.replace(/[\s().-]/g, "");
      return phonePatterns.some((re) => re.test(v) || re.test(compact));
    };
    const isTestEmail = (v: string) => emailPatterns.some((re) => re.test(v));

    const phones = [
      ...new Set([
        ...page.tel.map((t) => t.trim()),
        ...(page.mainText.match(PHONE_RE) ?? []).map((t) => t.trim()),
      ]),
    ];
    const emails = [
      ...new Set([
        ...page.mailto.map((m) => m.trim().replace(/\?.*$/s, "")),
        ...(page.mainText.match(EMAIL_RE) ?? []),
      ]),
    ];
    for (const p of phones)
      if (p !== "" && isTestPhone(p))
        ctx.report({ message: `Phone "${p}" looks like a test number` });
    for (const e of emails)
      if (e !== "" && isTestEmail(e))
        ctx.report({ message: `Email "${e}" looks like a test address` });

    const biz = ctx.config.business?.phone;
    if (biz !== undefined && biz.trim() !== "") {
      const expected = normalizePhone(biz);
      for (const t of [...new Set(page.tel.map((x) => x.trim()))])
        if (t !== "" && !isTestPhone(t) && normalizePhone(t) !== expected)
          ctx.report({
            message: `Phone "${t}" differs from business phone "${biz}"`,
          });
    }
  },
};
