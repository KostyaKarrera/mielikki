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
