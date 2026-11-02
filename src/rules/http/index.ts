import type { Rule } from "../types.js";
import { rule as canonicalRedirects } from "./canonical-redirects.js";
import { rule as crawlLimit } from "./crawl-limit.js";
import { rule as hostVariant } from "./host-variant.js";
import { rule as httpsRedirect } from "./https-redirect.js";
import { rule as notHttps } from "./not-https.js";
import { rule as redirectChain } from "./redirect-chain.js";
import { rule as redirectTemporary } from "./redirect-temporary.js";
import { rule as robotsStatus } from "./robots-status.js";
import { rule as slashVariants } from "./slash-variants.js";
import { rule as unreachable } from "./unreachable.js";

export const httpRules: Rule[] = [
  canonicalRedirects,
  crawlLimit,
  hostVariant,
  httpsRedirect,
  notHttps,
  redirectChain,
  redirectTemporary,
  robotsStatus,
  slashVariants,
  unreachable,
];
