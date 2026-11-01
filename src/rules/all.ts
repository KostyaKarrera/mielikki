import { a11yRules } from "./a11y/index.js";
import { aiRules } from "./ai/index.js";
import { contentRules } from "./content/index.js";
import { coreRules } from "./core/index.js";
import { crawlRules } from "./crawl/index.js";
import { i18nRules } from "./i18n/index.js";
import { imagesRules } from "./images/index.js";
import { legalRules } from "./legal/index.js";
import { linksRules } from "./links/index.js";
import { localRules } from "./local/index.js";
import { mobileRules } from "./mobile/index.js";
import { schemaRules } from "./schema/index.js";
import { socialRules } from "./social/index.js";
import { targetsRules } from "./targets/index.js";
import type { Rule } from "./types.js";

export const allRules: Rule[] = [
  ...a11yRules,
  ...aiRules,
  ...coreRules,
  ...contentRules,
  ...crawlRules,
  ...i18nRules,
  ...imagesRules,
  ...legalRules,
  ...linksRules,
  ...localRules,
  ...mobileRules,
  ...schemaRules,
  ...socialRules,
  ...targetsRules,
].sort((a, b) => (a.meta.id < b.meta.id ? -1 : a.meta.id > b.meta.id ? 1 : 0));
