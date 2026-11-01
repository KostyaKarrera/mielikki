import type { Rule } from "../types.js";
import { rule as ogImageBroken } from "./og-image-broken.js";
import { rule as ogMissing } from "./og-missing.js";
import { rule as ogUrlMismatch } from "./og-url-mismatch.js";
import { rule as twitterCard } from "./twitter-card.js";

export const socialRules: Rule[] = [
  ogImageBroken,
  ogMissing,
  ogUrlMismatch,
  twitterCard,
];
