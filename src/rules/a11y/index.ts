import type { Rule } from "../types.js";
import { rule as buttonName } from "./button-name.js";
import { rule as formLabel } from "./form-label.js";

export const a11yRules: Rule[] = [buttonName, formLabel];
