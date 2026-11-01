import type { SiteRule } from "../types.js";

const CONTACT = /yhteystiedot|kontakt|contact/i;

export const rule: SiteRule = {
  meta: {
    id: "legal/contact-page",
    title: "No contact page",
    category: "legal",
    severity: "info",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Add a contact page (e.g. /yhteystiedot/) and link to it.",
    source: "mielikki:original",
  },
  checkSite(ctx) {
    const { pages } = ctx.site;
    const found =
      pages.some((p) => CONTACT.test(p.key)) ||
      pages.some((p) =>
        p.links.some(
          (l) =>
            l.internal &&
            (CONTACT.test(l.text) ||
              (l.key !== undefined && CONTACT.test(l.key))),
        ),
      );
    if (!found) ctx.report({ message: "No contact page or link to one found" });
  },
};
