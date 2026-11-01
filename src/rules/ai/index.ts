import type { Rule } from "../types.js";
import { rule as crawlerAccess } from "./crawler-access.js";

export const aiRules: Rule[] = [crawlerAccess];
