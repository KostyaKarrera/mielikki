import type { Rule } from "../types.js";
import { rule as viewportMissing } from "./viewport-missing.js";
import { rule as zoomDisabled } from "./zoom-disabled.js";

export const mobileRules: Rule[] = [viewportMissing, zoomDisabled];
