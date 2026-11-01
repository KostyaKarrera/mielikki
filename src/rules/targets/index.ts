import type { Rule } from "../types.js";
import { rule as cannibalization } from "./cannibalization.js";
import { rule as missingTarget } from "./missing-target.js";
import { rule as notIndexable } from "./not-indexable.js";
import { rule as pageMissing } from "./page-missing.js";
import { rule as primaryInDescription } from "./primary-in-description.js";
import { rule as primaryInH1 } from "./primary-in-h1.js";
import { rule as primaryInIntro } from "./primary-in-intro.js";
import { rule as primaryInTitle } from "./primary-in-title.js";
import { rule as secondaryInText } from "./secondary-in-text.js";

export const targetsRules: Rule[] = [
  cannibalization,
  missingTarget,
  notIndexable,
  pageMissing,
  primaryInDescription,
  primaryInH1,
  primaryInIntro,
  primaryInTitle,
  secondaryInText,
];
