import type { Config, Severity } from "../config/schema.js";
import type { LangModule } from "../lang/index.js";
import type { Page, Site } from "../model/types.js";

export type { Severity };
export type Profile = "dev" | "launch";

export interface RuleMeta {
  id: string;
  title: string;
  category: string;
  severity: Severity; // base severity
  scope: "page" | "site";
  inputs: ("dir" | "url")[];
  launchBlocking: boolean; // becomes error in the launch profile
  prelaunchExpected?: boolean; // info in dev when config.prelaunch
  fix: string;
  source: string; // doc URL, 'claude-seo:<path>' or 'squirrelscan:<rule-id>'
  defaultOff?: boolean;
  defaultOptions?: Record<string, unknown>; // shown by `rules explain`
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  url?: string;
  message: string;
  fix: string;
  details?: Record<string, unknown>;
}

export interface Report {
  message: string;
  url?: string;
  severity?: Severity;
  details?: Record<string, unknown>;
  /** This finding is never raised to error by the launch profile. */
  nonBlocking?: boolean;
}

export interface RuleContext {
  site: Site;
  config: Config;
  lang: LangModule;
  profile: Profile;
  /** Merges config.rules.options[rule.id] over the defaults. */
  options<T>(defaults: T): T;
  report(r: Report): void;
}

export interface PageRule {
  meta: RuleMeta & { scope: "page" };
  checkPage(page: Page, ctx: RuleContext): void | Promise<void>;
}

export interface SiteRule {
  meta: RuleMeta & { scope: "site" };
  checkSite(ctx: RuleContext): void | Promise<void>;
}

export type Rule = PageRule | SiteRule;
