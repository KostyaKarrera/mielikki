import type { SiteRule } from "../types.js";

const TRAINING = [
  "GPTBot",
  "ClaudeBot",
  "Google-Extended",
  "Applebot-Extended",
  "Bytespider",
  "CCBot",
];
const SEARCH = [
  "OAI-SearchBot",
  "Claude-SearchBot",
  "PerplexityBot",
  "ChatGPT-User",
  "Claude-User",
];
const WARN_ON = ["OAI-SearchBot", "Claude-SearchBot", "PerplexityBot"];

export const rule: SiteRule = {
  meta: {
    id: "ai/crawler-access",
    title: "AI crawler access in robots.txt",
    category: "ai",
    severity: "info",
    scope: "site",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Allow AI search bots (OAI-SearchBot, Claude-SearchBot, PerplexityBot) in robots.txt if you want to be cited; blocking training crawlers is optional.",
    source: "claude-seo:skills/seo-technical/SKILL.md",
  },
  checkSite(ctx) {
    const robots = ctx.site.robots;
    if (robots === undefined) return;
    const agents = new Set(
      robots.raw
        .split(/\r?\n/)
        .map((l) => /^\s*user-agent\s*:\s*([^#\s]+)/i.exec(l)?.[1])
        .filter((a): a is string => a !== undefined)
        .map((a) => a.toLowerCase()),
    );
    const tokens = [...TRAINING, ...SEARCH];
    const allowed: string[] = [];
    const blocked: string[] = [];
    const explicit: string[] = [];
    for (const t of tokens) {
      (robots.isAllowed("/", t) ? allowed : blocked).push(t);
      if (agents.has(t.toLowerCase())) explicit.push(t);
    }
    const blockedSearch = WARN_ON.filter(
      (t) => blocked.includes(t) && explicit.includes(t),
    );
    const part = (list: string[]): string =>
      list.filter((t) => blocked.includes(t)).join(", ") || "none";
    ctx.report({
      message: `AI crawlers blocked at /: training [${part(TRAINING)}]; search/citation [${part(SEARCH)}]`,
      severity: blockedSearch.length > 0 ? "warning" : undefined,
      details: {
        allowed,
        blocked,
        explicit,
        training: TRAINING,
        search: SEARCH,
      },
    });
  },
};
