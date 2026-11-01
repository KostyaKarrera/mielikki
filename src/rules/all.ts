import { contentRules } from "./content/index.js";
import { coreRules } from "./core/index.js";
import { crawlRules } from "./crawl/index.js";
import { i18nRules } from "./i18n/index.js";
import { imagesRules } from "./images/index.js";
import { linksRules } from "./links/index.js";
import { mobileRules } from "./mobile/index.js";
import { socialRules } from "./social/index.js";
import type { Rule } from "./types.js";

export const allRules: Rule[] = [
  ...coreRules,
  ...contentRules,
  ...crawlRules,
  ...i18nRules,
  ...imagesRules,
  ...linksRules,
  ...mobileRules,
  ...socialRules,
].sort((a, b) => (a.meta.id < b.meta.id ? -1 : a.meta.id > b.meta.id ? 1 : 0));
