import type { Rule } from "../types.js";
import { rule as altMissing } from "./alt-missing.js";
import { rule as broken } from "./broken.js";
import { rule as dimensions } from "./dimensions.js";
import { rule as lazyAboveFold } from "./lazy-above-fold.js";
import { rule as modernFormat } from "./modern-format.js";
import { rule as weight } from "./weight.js";

export const imagesRules: Rule[] = [
  altMissing,
  broken,
  dimensions,
  lazyAboveFold,
  modernFormat,
  weight,
];
