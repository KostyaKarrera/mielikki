import type { SiteRule } from "../types.js";
import { isLocalOrigin, startUrl } from "./_helpers.js";

export const rule: SiteRule = {
  meta: {
    id: "http/security-headers",
    title: "Security headers are missing",
    category: "http",
    severity: "info",
    scope: "site",
    inputs: ["url"],
    launchBlocking: false,
    fix: "Send X-Content-Type-Options: nosniff, Referrer-Policy, X-Frame-Options (or CSP frame-ancestors) and, on https, Strict-Transport-Security.",
    source: "https://developer.mozilla.org/en-US/docs/Web/Security",
  },
  checkSite(ctx) {
    const { site } = ctx;
    const start = startUrl(site);
    const f = site.responses?.get(start)?.final;
    const h = f?.headers ?? site.pages[0]?.headers;
    if (h === undefined) return;
    const finalUrl = f?.url ?? site.pages[0]?.url ?? start;
    const missing: string[] = [];
    if (h["x-content-type-options"]?.toLowerCase().trim() !== "nosniff")
      missing.push("x-content-type-options");
    if (h["referrer-policy"] === undefined) missing.push("referrer-policy");
    if (
      h["x-frame-options"] === undefined &&
      !/frame-ancestors/i.test(h["content-security-policy"] ?? "")
    )
      missing.push("x-frame-options");
    if (
      finalUrl.startsWith("https:") &&
      !isLocalOrigin(site) &&
      h["strict-transport-security"] === undefined
    )
      missing.push("strict-transport-security");
    if (missing.length === 0) return;
    ctx.report({
      url: finalUrl,
      message: `Start page lacks security headers: ${missing.join(", ")}`,
      details: { missing },
    });
  },
};
