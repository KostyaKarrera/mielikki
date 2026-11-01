import { crawlRules } from "./crawl/index.js";
import type { Rule } from "./types.js";

export const allRules: Rule[] = [...crawlRules].sort((a, b) =>
  a.meta.id < b.meta.id ? -1 : a.meta.id > b.meta.id ? 1 : 0,
);
