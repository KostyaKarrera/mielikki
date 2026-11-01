import type { CheckResult } from "./result.js";

export function renderJson(r: CheckResult): string {
  return `${JSON.stringify(r, null, 2)}\n`;
}
