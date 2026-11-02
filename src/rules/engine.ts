import type { Config, Severity } from "../config/schema.js";
import { getLang } from "../lang/index.js";
import type { Page, Site } from "../model/types.js";
import type {
  Finding,
  Profile,
  Report,
  Rule,
  RuleContext,
  RuleMeta,
} from "./types.js";

export function resolveSeverity(
  base: Severity,
  meta: RuleMeta,
  config: Config,
  profile: Profile,
  nonBlocking = false,
): Severity {
  let sev = config.rules.severity[meta.id] ?? base;
  if (profile === "dev" && config.prelaunch && meta.prelaunchExpected) {
    sev = "info";
  }
  if (
    profile === "launch" &&
    !nonBlocking &&
    (config.rules.launchBlocking[meta.id] ?? meta.launchBlocking) &&
    sev !== "info"
  ) {
    sev = "error";
  }
  return sev;
}

const ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function sortFindings(findings: Finding[]): Finding[] {
  return findings.sort(
    (a, b) =>
      ORDER[a.severity] - ORDER[b.severity] ||
      cmp(a.ruleId, b.ruleId) ||
      cmp(a.url ?? "", b.url ?? "") ||
      cmp(a.message, b.message),
  );
}

export async function runRules(
  site: Site,
  rules: Rule[],
  config: Config,
  profile: Profile,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const lang = getLang(config.language);
  const mode = site.input.kind;

  const makeCtx = (rule: Rule, defaultUrl?: string): RuleContext => ({
    site,
    config,
    lang,
    profile,
    options<T>(defaults: T): T {
      return {
        ...defaults,
        ...config.rules.options[rule.meta.id],
      } as T;
    },
    report(r: Report): void {
      const finding: Finding = {
        ruleId: rule.meta.id,
        severity: resolveSeverity(
          r.severity ?? rule.meta.severity,
          rule.meta,
          config,
          profile,
          r.nonBlocking === true,
        ),
        message: r.message,
        fix: rule.meta.fix,
      };
      const url = r.url ?? defaultUrl;
      if (url !== undefined) finding.url = url;
      if (r.details !== undefined) finding.details = r.details;
      findings.push(finding);
    },
  });

  const crash = (rule: Rule, e: unknown): void => {
    findings.push({
      ruleId: "internal/rule-error",
      severity: "warning",
      message: `${rule.meta.id}: ${e instanceof Error ? e.message : String(e)}`,
      fix: "This is a bug in the rule; please report it.",
    });
  };

  const pages: Page[] = site.pages; // exclude.ignore already applied by the loader
  for (const rule of rules) {
    if (!rule.meta.inputs.includes(mode)) continue;
    if ("checkSite" in rule) {
      try {
        await rule.checkSite(makeCtx(rule));
      } catch (e) {
        crash(rule, e);
      }
    } else {
      for (const page of pages) {
        try {
          await rule.checkPage(page, makeCtx(rule, page.key));
        } catch (e) {
          crash(rule, e);
        }
      }
    }
  }
  return sortFindings(findings);
}
