import { matchPath } from "../glob.js";
import type { SiteRule } from "../types.js";

export const rule: SiteRule = {
  meta: {
    id: "legal/privacy-policy",
    title: "No privacy policy link",
    category: "legal",
    severity: "warning",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: true,
    fix: "Publish a privacy policy page and link to it from the footer.",
    source: "mielikki:original",
    defaultOptions: { path: undefined },
  },
  checkSite(ctx) {
    const { path } = ctx.options<{ path?: string }>({ path: undefined });
    if (path !== undefined) {
      if (!ctx.site.pages.some((p) => matchPath(path, p.key)))
        ctx.report({ message: `Privacy policy page ${path} does not exist` });
      return;
    }
    const patterns = ctx.lang.privacyPatterns;
    const found = ctx.site.pages.some((p) =>
      p.links.some(
        (l) =>
          l.internal &&
          patterns.some(
            (re) =>
              re.test(l.text.toLowerCase()) ||
              (l.key !== undefined && re.test(l.key.toLowerCase())),
          ),
      ),
    );
    if (!found)
      ctx.report({ message: "No internal link to a privacy policy found" });
  },
};
