import type { Rule } from "../types.js";
import { rule as nameConsistency } from "./name-consistency.js";
import { rule as phoneConsistency } from "./phone-consistency.js";
import { rule as swapTest } from "./swap-test.js";
import { rule as telLink } from "./tel-link.js";

export const localRules: Rule[] = [
  nameConsistency,
  phoneConsistency,
  swapTest,
  telLink,
];
