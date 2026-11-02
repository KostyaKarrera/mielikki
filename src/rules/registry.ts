import type { Config } from "../config/schema.js";
import { matchGlob } from "./glob.js";
import type { Rule } from "./types.js";

const matchesAny = (masks: string[], id: string): boolean =>
  masks.some((m) => matchGlob(m, id));

/**
 * Default: every rule except `defaultOff`. `rules.enable` adds, `rules.disable`
 * removes (glob masks). A non-empty `include` (--rules) replaces the set.
 */
export function selectRules(
  all: Rule[],
  config: Config,
  include?: string[],
): Rule[] {
  if (include && include.length > 0) {
    return all.filter((r) => matchesAny(include, r.meta.id));
  }
  const { enable, disable } = config.rules;
  return all.filter((r) => {
    const id = r.meta.id;
    if (matchesAny(disable, id)) return false;
    return !r.meta.defaultOff || matchesAny(enable, id);
  });
}

/**
 * One message per entry in rules.disable/enable (masks) or
 * rules.severity/launchBlocking/options (rule ids) that matches no rule.
 */
export function unmatchedRuleEntries(all: Rule[], config: Config): string[] {
  const ids = all.map((r) => r.meta.id);
  const out: string[] = [];
  const { enable, disable, severity, launchBlocking, options } = config.rules;
  for (const [field, masks] of [
    ["disable", disable],
    ["enable", enable],
  ] as const)
    for (const m of masks)
      if (!ids.some((id) => matchGlob(m, id)))
        out.push(`rules.${field} "${m}" matches no rule`);
  for (const [field, map] of [
    ["severity", severity],
    ["launchBlocking", launchBlocking],
    ["options", options],
  ] as const)
    for (const id of Object.keys(map))
      if (!ids.includes(id)) out.push(`rules.${field} "${id}" matches no rule`);
  return out;
}
