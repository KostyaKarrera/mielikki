import type { Rule } from "../types.js";
import { rule as areaServed } from "./area-served.js";
import { rule as businessGenericType } from "./business-generic-type.js";
import { rule as businessMissing } from "./business-missing.js";
import { rule as deprecated } from "./deprecated.js";
import { rule as fakeRating } from "./fake-rating.js";
import { rule as identity } from "./identity.js";
import { rule as jsonldSyntax } from "./jsonld-syntax.js";
import { rule as napMismatch } from "./nap-mismatch.js";
import { rule as validation } from "./validation.js";

export const schemaRules: Rule[] = [
  areaServed,
  businessGenericType,
  businessMissing,
  deprecated,
  fakeRating,
  identity,
  jsonldSyntax,
  napMismatch,
  validation,
];
