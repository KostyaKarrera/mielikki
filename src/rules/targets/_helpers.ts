import type { TargetPage } from "../../config/schema.js";
import type { Page } from "../../model/types.js";
import { pageKey } from "../../model/url.js";
import type { RuleContext } from "../types.js";

export interface ResolvedTarget {
  target: TargetPage;
  key: string;
  page: Page | undefined;
}

/** Targets with normalized url keys, in config order, paired with their page (if any). */
export function resolveTargets(ctx: RuleContext): ResolvedTarget[] {
  return ctx.config.targets.pages.map((target) => {
    const key = pageKey(target.url);
    return { target, key, page: ctx.site.byKey.get(key) };
  });
}
