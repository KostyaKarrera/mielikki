import type { SiteRule } from "../types.js";

/** URL mode: a sitemap on the crawl host is shown by its path, as in a directory. */
function sitemapPath(file: string, origin: string | undefined): string {
  if (origin === undefined || !URL.canParse(file)) return file;
  const u = new URL(file);
  if (u.origin !== origin) return file;
  try {
    return decodeURIComponent(u.pathname) + u.search;
  } catch {
    return u.pathname + u.search;
  }
}

export const rule: SiteRule = {
  meta: {
    id: "crawl/sitemap-invalid",
    title: "Sitemap is invalid or empty",
    category: "crawl",
    severity: "error",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: true,
    fix: "Fix the sitemap XML so it parses and lists at least one URL.",
    source:
      "https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap",
  },
  checkSite(ctx) {
    const { origin } = ctx.site;
    for (const sm of ctx.site.sitemaps) {
      const file = sitemapPath(sm.file, origin);
      if (!sm.ok)
        ctx.report({
          url: file,
          message: `Sitemap ${file} is invalid: ${sm.error ?? "unknown error"}`,
        });
      else if (sm.urls.length === 0)
        ctx.report({
          url: file,
          message: `Sitemap ${file} lists 0 URLs`,
        });
    }
  },
};
