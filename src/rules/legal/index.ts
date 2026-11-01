import type { Rule } from "../types.js";
import { rule as contactPage } from "./contact-page.js";
import { rule as privacyPolicy } from "./privacy-policy.js";

export const legalRules: Rule[] = [privacyPolicy, contactPage];
