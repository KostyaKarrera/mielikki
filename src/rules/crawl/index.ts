import type { Rule } from "../types.js";
import { rule as canonicalTarget } from "./canonical-target.js";
import { rule as depth } from "./depth.js";
import { rule as noindex } from "./noindex.js";
import { rule as noindexExpectedMissing } from "./noindex-expected-missing.js";
import { rule as orphan } from "./orphan.js";
import { rule as robotsBlocksAll } from "./robots-blocks-all.js";
import { rule as robotsBlocksAssets } from "./robots-blocks-assets.js";
import { rule as robotsBlocksPage } from "./robots-blocks-page.js";
import { rule as robotsMissing } from "./robots-missing.js";
import { rule as robotsNoSitemap } from "./robots-no-sitemap.js";
import { rule as siteUrlNotConfigured } from "./site-url-not-configured.js";
import { rule as sitemapBadEntry } from "./sitemap-bad-entry.js";
import { rule as sitemapForeignHost } from "./sitemap-foreign-host.js";
import { rule as sitemapInvalid } from "./sitemap-invalid.js";
import { rule as sitemapMissing } from "./sitemap-missing.js";
import { rule as sitemapMissingPage } from "./sitemap-missing-page.js";
import { rule as thinHtml } from "./thin-html.js";

export const crawlRules: Rule[] = [
  canonicalTarget,
  depth,
  noindex,
  noindexExpectedMissing,
  orphan,
  robotsBlocksAll,
  robotsBlocksAssets,
  robotsBlocksPage,
  robotsMissing,
  robotsNoSitemap,
  siteUrlNotConfigured,
  sitemapBadEntry,
  sitemapForeignHost,
  sitemapInvalid,
  sitemapMissing,
  sitemapMissingPage,
  thinHtml,
];
