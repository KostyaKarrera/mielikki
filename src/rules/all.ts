import { coreRules } from "./core/index.js";
import { crawlRules } from "./crawl/index.js";
import { mobileRules } from "./mobile/index.js";
import type { Rule } from "./types.js";

export const allRules: Rule[] = [
  ...coreRules,
  ...crawlRules,
  ...mobileRules,
].sort((a, b) => (a.meta.id < b.meta.id ? -1 : a.meta.id > b.meta.id ? 1 : 0));
