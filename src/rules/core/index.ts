import type { Rule } from "../types.js";
import { rule as canonicalInvalid } from "./canonical-invalid.js";
import { rule as canonicalMissing } from "./canonical-missing.js";
import { rule as charsetMissing } from "./charset-missing.js";
import { rule as descriptionDuplicate } from "./description-duplicate.js";
import { rule as descriptionLength } from "./description-length.js";
import { rule as descriptionMissing } from "./description-missing.js";
import { rule as descriptionRepeatsTitle } from "./description-repeats-title.js";
import { rule as h1Missing } from "./h1-missing.js";
import { rule as h1Multiple } from "./h1-multiple.js";
import { rule as headingSkip } from "./heading-skip.js";
import { rule as langMismatch } from "./lang-mismatch.js";
import { rule as langMissing } from "./lang-missing.js";
import { rule as titleDuplicate } from "./title-duplicate.js";
import { rule as titleLength } from "./title-length.js";
import { rule as titleMissing } from "./title-missing.js";
import { rule as titleMultiple } from "./title-multiple.js";

export const coreRules: Rule[] = [
  canonicalInvalid,
  canonicalMissing,
  charsetMissing,
  descriptionDuplicate,
  descriptionLength,
  descriptionMissing,
  descriptionRepeatsTitle,
  h1Missing,
  h1Multiple,
  headingSkip,
  langMismatch,
  langMissing,
  titleDuplicate,
  titleLength,
  titleMissing,
  titleMultiple,
];
