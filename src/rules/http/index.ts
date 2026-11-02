import type { Rule } from "../types.js";
import { rule as cacheHeaders } from "./cache-headers.js";
import { rule as canonicalRedirects } from "./canonical-redirects.js";
import { rule as compression } from "./compression.js";
import { rule as crawlLimit } from "./crawl-limit.js";
import { rule as hostVariant } from "./host-variant.js";
import { rule as httpsRedirect } from "./https-redirect.js";
import { rule as mixedContent } from "./mixed-content.js";
import { rule as notFoundPage } from "./not-found-page.js";
import { rule as notHttps } from "./not-https.js";
import { rule as redirectChain } from "./redirect-chain.js";
import { rule as redirectTemporary } from "./redirect-temporary.js";
import { rule as robotsStatus } from "./robots-status.js";
import { rule as securityHeaders } from "./security-headers.js";
import { rule as slashVariants } from "./slash-variants.js";
import { rule as soft404 } from "./soft-404.js";
import { rule as unreachable } from "./unreachable.js";

export const httpRules: Rule[] = [
  cacheHeaders,
  canonicalRedirects,
  compression,
  crawlLimit,
  hostVariant,
  httpsRedirect,
  mixedContent,
  notFoundPage,
  notHttps,
  redirectChain,
  redirectTemporary,
  robotsStatus,
  securityHeaders,
  slashVariants,
  soft404,
  unreachable,
];
