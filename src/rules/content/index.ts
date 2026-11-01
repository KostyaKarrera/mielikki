import type { Rule } from "../types.js";
import { rule as keywordStuffing } from "./keyword-stuffing.js";
import { rule as nearDuplicate } from "./near-duplicate.js";
import { rule as placeholder } from "./placeholder.js";
import { rule as testContact } from "./test-contact.js";
import { rule as wordCount } from "./word-count.js";

export const contentRules: Rule[] = [
  keywordStuffing,
  nearDuplicate,
  placeholder,
  testContact,
  wordCount,
];
