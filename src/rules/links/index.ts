import type { Rule } from "../types.js";
import { rule as brokenInternal } from "./broken-internal.js";
import { rule as deadEnd } from "./dead-end.js";
import { rule as emptyAnchor } from "./empty-anchor.js";
import { rule as genericAnchor } from "./generic-anchor.js";
import { rule as insecureExternal } from "./insecure-external.js";
import { rule as redirected } from "./redirected.js";
import { rule as trailingSlash } from "./trailing-slash.js";

export const linksRules: Rule[] = [
  brokenInternal,
  deadEnd,
  emptyAnchor,
  genericAnchor,
  insecureExternal,
  redirected,
  trailingSlash,
];
