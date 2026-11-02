import { describe, expect, it } from "vitest";
import type { Config } from "../../src/config/schema.js";
import { runRules } from "../../src/rules/engine.js";
import { selectRules } from "../../src/rules/registry.js";
import type { PageRule, Rule, SiteRule } from "../../src/rules/types.js";
import { runRule, siteFrom } from "../helpers.js";

const base = {
  title: "t",
  category: "test",
  severity: "warning" as const,
  inputs: ["dir" as const],
  launchBlocking: false,
  fix: "fix it",
  source: "test",
};

const siteRule = (
  id: string,
  extra: Partial<SiteRule["meta"]> = {},
  severity?: "error" | "warning" | "info",
): SiteRule => ({
  meta: { ...base, id, scope: "site", ...extra },
  checkSite: (ctx) => ctx.report({ message: "m", severity }),
});

const pageRule = (id: string): PageRule => ({
  meta: { ...base, id, scope: "page" },
  checkPage: (page, ctx) => ctx.report({ message: `p ${page.key}` }),
});

const html = "<html><body><h1>x</h1></body></html>";
const files = { "index.html": html, "a/index.html": html };
const rules = (r: Partial<Config["rules"]>) => ({
  rules: {
    enable: [],
    disable: [],
    severity: {},
    launchBlocking: {},
    options: {},
    ...r,
  },
});

describe("engine", () => {
  it("nonBlocking findings are not escalated in launch", async () => {
    const site = await siteFrom(files);
    const rule: SiteRule = {
      meta: { ...base, id: "t/nb", scope: "site", launchBlocking: true },
      checkSite: (ctx) => {
        ctx.report({ message: "soft", nonBlocking: true });
        ctx.report({ message: "hard" });
      },
    };
    const launch = await runRule(rule, site, "launch");
    expect(launch.map((f) => [f.message, f.severity])).toEqual([
      ["hard", "error"],
      ["soft", "warning"],
    ]);
    // config override of launchBlocking does not escalate it either
    const forced = await siteFrom(
      files,
      rules({ launchBlocking: { "t/nb": true } }),
    );
    expect(
      (await runRule(rule, forced, "launch")).find((f) => f.message === "soft")
        ?.severity,
    ).toBe("warning");
  });

  it("severity override from config", async () => {
    const site = await siteFrom(files, rules({ severity: { "t/a": "error" } }));
    const f = await runRule(siteRule("t/a"), site);
    expect(f[0]?.severity).toBe("error");
  });

  it("prelaunch downgrades expected rules in dev", async () => {
    const site = await siteFrom(files, { prelaunch: true });
    const rule = siteRule("t/a", { prelaunchExpected: true });
    expect((await runRule(rule, site, "dev"))[0]?.severity).toBe("info");
    expect((await runRule(rule, site, "launch"))[0]?.severity).toBe("warning");
  });

  it("launch escalates blocking warning to error", async () => {
    const site = await siteFrom(files);
    const f = await runRule(
      siteRule("t/a", { launchBlocking: true }),
      site,
      "launch",
    );
    expect(f[0]?.severity).toBe("error");
  });

  it("launch keeps info as info", async () => {
    const site = await siteFrom(files);
    const f = await runRule(
      siteRule("t/a", { launchBlocking: true }, "info"),
      site,
      "launch",
    );
    expect(f[0]?.severity).toBe("info");
  });

  it("config launchBlocking=false disables escalation", async () => {
    const site = await siteFrom(
      files,
      rules({ launchBlocking: { "t/a": false } }),
    );
    const f = await runRule(
      siteRule("t/a", { launchBlocking: true }),
      site,
      "launch",
    );
    expect(f[0]?.severity).toBe("warning");
  });

  it("sorted deterministically", async () => {
    const site = await siteFrom(files);
    const all: Rule[] = [
      pageRule("t/z"),
      siteRule("t/b", {}, "error"),
      pageRule("t/a"),
    ];
    const one = await runRules(site, all, site.config, "dev");
    const two = await runRules(site, [...all].reverse(), site.config, "dev");
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
    expect(one[0]?.severity).toBe("error");
    expect(one.map((f) => f.ruleId)).toEqual([
      "t/b",
      "t/a",
      "t/a",
      "t/z",
      "t/z",
    ]);
  });

  it("ignore excludes pages", async () => {
    const site = await siteFrom(files, {
      exclude: { noindexExpected: [], ignore: ["/a/"] },
    });
    const f = await runRule(pageRule("t/p"), site);
    expect(f.map((x) => x.url)).toEqual(["/"]);
  });

  it("disable mask 'links/*'", async () => {
    const site = await siteFrom(files, rules({ disable: ["links/*"] }));
    const all = [
      siteRule("links/broken"),
      siteRule("meta/title"),
      siteRule("links/a/b"),
    ];
    expect(selectRules(all, site.config).map((r) => r.meta.id)).toEqual([
      "meta/title",
      "links/a/b",
    ]);
  });

  it("selectRules: defaultOff, enable and include", async () => {
    const site = await siteFrom(files, rules({ enable: ["x/*"] }));
    const all = [
      siteRule("x/off", { defaultOff: true }),
      siteRule("y/off", { defaultOff: true }),
      siteRule("z/on"),
    ];
    expect(selectRules(all, site.config).map((r) => r.meta.id)).toEqual([
      "x/off",
      "z/on",
    ]);
    expect(
      selectRules(all, site.config, ["y/*"]).map((r) => r.meta.id),
    ).toEqual(["y/off"]);
  });

  it("rule crash isolated", async () => {
    const site = await siteFrom(files);
    const bad: SiteRule = {
      meta: { ...base, id: "t/bad", scope: "site" },
      checkSite: () => {
        throw new Error("boom");
      },
    };
    const f = await runRules(site, [bad, siteRule("t/ok")], site.config, "dev");
    expect(f.find((x) => x.ruleId === "internal/rule-error")).toMatchObject({
      severity: "warning",
      message: "t/bad: boom",
    });
    expect(f.some((x) => x.ruleId === "t/ok")).toBe(true);
  });

  it("page rule crash carries the page url", async () => {
    const site = await siteFrom(files);
    const bad: PageRule = {
      meta: { ...base, id: "t/pbad", scope: "page" },
      checkPage: (page) => {
        if (page.key === "/a/") throw new Error("boom");
      },
    };
    const f = await runRules(site, [bad], site.config, "dev");
    expect(f).toEqual([
      expect.objectContaining({
        ruleId: "internal/rule-error",
        url: "/a/",
        message: "t/pbad: boom",
      }),
    ]);
  });

  it("options merges config over defaults", async () => {
    const site = await siteFrom(
      files,
      rules({ options: { "t/o": { max: 5 } } }),
    );
    let seen: unknown;
    const r: SiteRule = {
      meta: { ...base, id: "t/o", scope: "site" },
      checkSite: (ctx) => {
        seen = ctx.options({ max: 1, min: 2 });
      },
    };
    await runRule(r, site);
    expect(seen).toEqual({ max: 5, min: 2 });
  });
});
