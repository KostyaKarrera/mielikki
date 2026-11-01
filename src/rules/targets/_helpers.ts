import type { Config, TargetPage } from "../../config/schema.js";
import type { Page } from "../../model/types.js";
import { targetKey } from "../content/_helpers.js";
import type { RuleContext } from "../types.js";

export interface ResolvedTarget {
  target: TargetPage;
  key: string;
  page: Page | undefined;
}

/** Targets with normalized url keys, in config order, paired with their page (if any). */
export function resolveTargets(ctx: RuleContext): ResolvedTarget[] {
  return ctx.config.targets.pages.map((target) => {
    const key = targetKey(target.url);
    return { target, key, page: ctx.site.byKey.get(key) };
  });
}

/**
 * True when `key` is a configured target page. Indexing problems of target
 * pages are reported by targets/not-indexable; generic crawl rules skip them.
 */
export function isTargetPage(config: Config, key: string): boolean {
  return config.targets.pages.some((t) => targetKey(t.url) === key);
}
