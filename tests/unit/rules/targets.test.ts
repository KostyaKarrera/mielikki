import { describe, expect, it } from "vitest";
import type { Config, TargetPage } from "../../../src/config/schema.js";
import { allRules } from "../../../src/rules/all.js";
import { runRules } from "../../../src/rules/engine.js";
import { rule as cannibalization } from "../../../src/rules/targets/cannibalization.js";
import { rule as missingTarget } from "../../../src/rules/targets/missing-target.js";
import { rule as notIndexable } from "../../../src/rules/targets/not-indexable.js";
import { rule as pageMissing } from "../../../src/rules/targets/page-missing.js";
import { rule as primaryInDescription } from "../../../src/rules/targets/primary-in-description.js";
import { rule as primaryInH1 } from "../../../src/rules/targets/primary-in-h1.js";
import { rule as primaryInIntro } from "../../../src/rules/targets/primary-in-intro.js";
import { rule as primaryInTitle } from "../../../src/rules/targets/primary-in-title.js";
import { rule as secondaryInText } from "../../../src/rules/targets/secondary-in-text.js";
import { runRule, siteFrom } from "../../helpers.js";

const page = (o: {
  title?: string;
  h1?: string;
  desc?: string;
  body?: string;
  head?: string;
}) =>
  `<html lang="fi"><head>${o.title ? `<title>${o.title}</title>` : ""}${
    o.desc ? `<meta name="description" content="${o.desc}">` : ""
  }${o.head ?? ""}</head><body><main>${o.h1 ? `<h1>${o.h1}</h1>` : ""}${
    o.body ?? ""
  }</main></body></html>`;
const target = (
  url: string,
  primary: string,
  extra: Partial<TargetPage> = {},
): TargetPage => ({
  url,
  primary,
  secondary: [],
  forms: {},
  ...extra,
});
const cfg = (
  pages: TargetPage[],
  extra: Partial<Config> = {},
): Partial<Config> => ({
  language: "fi" as const,
  targets: { required: [], pages },
  ...extra,
});
const SVC = "/palvelut/sahkoasennukset/";
const svcFiles = (o = {}) => ({
  "palvelut/sahkoasennukset/index.html": page({
    title: "Sähköasennukset Loviisassa | Example",
    h1: "Sähköasennukset Loviisassa",
    desc: "Sähköasennukset Loviisassa ammattitaidolla.",
    body: "<p>Teemme sähköasennukset Loviisassa.</p>",
    ...o,
  }),
});
const run = async (
  rule: Parameters<typeof runRule>[0],
  files: Record<string, string>,
  config: Partial<Config>,
) => runRule(rule, await siteFrom(files, config));

describe("registry", () => {
  it("registers the 9 targets rules", () => {
    expect(
      allRules.filter((r) => r.meta.id.startsWith("targets/")),
    ).toHaveLength(9);
  });
});

describe("targets/page-missing", () => {
  it("fires per target without a page", async () => {
    const f = await run(
      pageMissing,
      svcFiles(),
      cfg([target(SVC, "x"), target("/puuttuu", "y")]),
    );
    expect(f).toHaveLength(1);
    expect(f[0]?.url).toBe("/puuttuu/");
  });
  it("silent when pages exist", async () => {
    expect(await run(pageMissing, svcFiles(), cfg([target(SVC, "x")]))).toEqual(
      [],
    );
  });
});

describe("targets/not-indexable", () => {
  const t = cfg([target(SVC, "sähköasennukset loviisa")]);
  it("fires on noindex", async () => {
    const f = await run(
      notIndexable,
      svcFiles({ head: '<meta name="robots" content="noindex">' }),
      t,
    );
    expect(f).toHaveLength(1);
  });
  it("fires on robots.txt disallow", async () => {
    const f = await run(
      notIndexable,
      { ...svcFiles(), "robots.txt": "User-agent: *\nDisallow: /palvelut/" },
      t,
    );
    expect(f).toHaveLength(1);
  });
  it("drops the robots reason when robots.txt blocks the whole site", async () => {
    const all = { ...svcFiles(), "robots.txt": "User-agent: *\nDisallow: /" };
    expect(await run(notIndexable, all, t)).toEqual([]);
    const f = await run(
      notIndexable,
      {
        ...all,
        ...svcFiles({ head: '<meta name="robots" content="noindex">' }),
      },
      t,
    );
    expect(f[0]?.details).toEqual({ reasons: ["noindex meta"] });
  });
  it("fires on foreign canonical", async () => {
    const f = await run(
      notIndexable,
      svcFiles({ head: '<link rel="canonical" href="/muu/">' }),
      t,
    );
    expect(f).toHaveLength(1);
  });
  it("silent for an open page and self-canonical", async () => {
    expect(
      await run(
        notIndexable,
        svcFiles({ head: `<link rel="canonical" href="${SVC}">` }),
        t,
      ),
    ).toEqual([]);
  });
  it("is info in dev prelaunch and error in launch", async () => {
    const config = { ...t, prelaunch: true };
    const site = await siteFrom(
      svcFiles({ head: '<meta name="robots" content="noindex">' }),
      config,
    );
    const dev = await runRules(site, [notIndexable], site.config, "dev");
    const launch = await runRules(site, [notIndexable], site.config, "launch");
    expect(dev.map((x) => x.severity)).toEqual(["info"]);
    expect(launch.map((x) => x.severity)).toEqual(["error"]);
  });
});

describe("targets/primary-in-title", () => {
  it("does not fire for the Finnish inflected title", async () => {
    const f = await run(
      primaryInTitle,
      svcFiles(),
      cfg([target(SVC, "sähköasennukset loviisa")]),
    );
    expect(f).toEqual([]);
  });
  it("errors when none matches", async () => {
    const f = await run(
      primaryInTitle,
      svcFiles({ title: "Etusivu | Example" }),
      cfg([target(SVC, "sähköasennukset loviisa")]),
    );
    expect(f.map((x) => x.severity)).toEqual(["error"]);
  });
  it("warns when partial", async () => {
    const f = await run(
      primaryInTitle,
      svcFiles({ title: "Sähköasennukset | Example" }),
      cfg([target(SVC, "sähköasennukset loviisa")]),
    );
    expect(f.map((x) => x.severity)).toEqual(["warning"]);
  });
  it("skips targets whose page is missing", async () => {
    expect(
      await run(primaryInTitle, svcFiles(), cfg([target("/ei/", "foo bar")])),
    ).toEqual([]);
  });
  it("silent when the title is missing (core/title-missing reports it)", async () => {
    expect(
      await run(
        primaryInTitle,
        svcFiles({ title: undefined }),
        cfg([target(SVC, "sähköasennukset loviisa")]),
      ),
    ).toEqual([]);
  });
  it("honours forms override for Helsinki", async () => {
    const files = {
      "helsinki/index.html": page({ title: "Sähkömies Helsingissä" }),
    };
    const forms = { helsinki: ["helsingissä", "helsingin"] };
    const stadi = {
      "helsinki/index.html": page({ title: "Sähkömies Stadissa" }),
    };
    const without = await run(
      primaryInTitle,
      stadi,
      cfg([target("/helsinki/", "sähkömies helsinki")]),
    );
    const stadiForms = await run(
      primaryInTitle,
      stadi,
      cfg([
        target("/helsinki/", "sähkömies helsinki", {
          forms: { helsinki: ["stadissa"] },
        }),
      ]),
    );
    const withForms = await run(
      primaryInTitle,
      files,
      cfg([target("/helsinki/", "sähkömies helsinki", { forms })]),
    );
    expect(without).toHaveLength(1);
    expect(withForms).toEqual([]);
    expect(stadiForms).toEqual([]);
  });
});

describe("targets/primary-in-h1", () => {
  const t = cfg([target(SVC, "sähköasennukset loviisa")]);
  it("silent when H1 contains it", async () => {
    expect(await run(primaryInH1, svcFiles(), t)).toEqual([]);
  });
  it("errors when H1 lacks it, warns on partial", async () => {
    const none = await run(primaryInH1, svcFiles({ h1: "Tervetuloa" }), t);
    expect(none.map((x) => x.severity)).toEqual(["error"]);
    const part = await run(primaryInH1, svcFiles({ h1: "Sähköasennukset" }), t);
    expect(part.map((x) => x.severity)).toEqual(["warning"]);
  });
  it("silent when the H1 is missing (core/h1-missing reports it)", async () => {
    expect(await run(primaryInH1, svcFiles({ h1: undefined }), t)).toEqual([]);
  });
});

describe("targets/primary-in-intro", () => {
  const t = cfg([target(SVC, "sähköasennukset loviisa")]);
  it("silent when intro contains it", async () => {
    expect(await run(primaryInIntro, svcFiles(), t)).toEqual([]);
  });
  it("warns when absent", async () => {
    const f = await run(
      primaryInIntro,
      svcFiles({ body: "<p>Tervetuloa meille kaikki.</p>" }),
      t,
    );
    expect(f.map((x) => x.severity)).toEqual(["warning"]);
  });
  it("silent when the intro is missing", async () => {
    expect(await run(primaryInIntro, svcFiles({ body: "" }), t)).toEqual([]);
  });
});

describe("targets/primary-in-description", () => {
  const t = cfg([target(SVC, "sähköasennukset loviisa")]);
  it("silent when description contains it", async () => {
    expect(await run(primaryInDescription, svcFiles(), t)).toEqual([]);
  });
  it("warns when absent", async () => {
    const f = await run(
      primaryInDescription,
      svcFiles({ desc: "Hyvää palvelua kaikille." }),
      t,
    );
    expect(f).toHaveLength(1);
  });
  it("silent when the description is missing (core/description-missing reports it)", async () => {
    expect(
      await run(primaryInDescription, svcFiles({ desc: undefined }), t),
    ).toEqual([]);
  });
});

describe("targets/secondary-in-text", () => {
  it("reports one info per absent secondary phrase", async () => {
    const f = await run(
      secondaryInText,
      svcFiles(),
      cfg([
        target(SVC, "x", {
          secondary: ["sähköasennukset", "kylpyhuone remontti", "jännite"],
        }),
      ]),
    );
    expect(f.map((x) => x.severity)).toEqual(["info", "info"]);
    expect(f.map((x) => x.details?.phrase).sort()).toEqual([
      "jännite",
      "kylpyhuone remontti",
    ]);
  });
  it("silent when all present", async () => {
    expect(
      await run(
        secondaryInText,
        svcFiles(),
        cfg([target(SVC, "x", { secondary: ["sähköasennukset loviisa"] })]),
      ),
    ).toEqual([]);
  });
});

describe("targets/cannibalization", () => {
  const files = {
    "a/index.html": page({ title: "a" }),
    "b/index.html": page({ title: "b" }),
    "c/index.html": page({ title: "c" }),
  };
  it("fires once per pair on the smaller url, ignoring order and inflection", async () => {
    const f = await run(
      cannibalization,
      files,
      cfg([
        target("/b/", "loviisan sähköasentaja"),
        target("/a/", "sähköasentaja loviisa"),
        target("/c/", "sähköurakointi porvoo"),
      ]),
    );
    expect(f).toHaveLength(1);
    expect(f[0]?.url).toBe("/a/");
    expect(f[0]?.message).toContain("/b/");
  });
  it("silent for distinct queries and different word counts", async () => {
    const f = await run(
      cannibalization,
      files,
      cfg([
        target("/a/", "sähköasentaja loviisa"),
        target("/b/", "sähköasentaja"),
        target("/c/", "sähköasentaja porvoo"),
      ]),
    );
    expect(f).toEqual([]);
  });
});

describe("targets/missing-target", () => {
  const files = {
    "index.html": page({ title: "Etusivu" }),
    "palvelut/a/index.html": page({ title: "A" }),
    "palvelut/b/index.html": page({ title: "B" }),
    "ohje/index.html": page({ title: "Ohje" }),
    "piilo/index.html": page({
      title: "P",
      head: '<meta name="robots" content="noindex">',
    }),
  };
  it("warns for required, info for the rest, skips targeted and non-indexable", async () => {
    const f = await run(
      missingTarget,
      files,
      cfg([target("/palvelut/a/", "x")], {
        targets: {
          required: ["/palvelut/*"],
          pages: [target("/palvelut/a/", "x")],
        },
      }),
    );
    const by = Object.fromEntries(f.map((x) => [x.url, x.severity]));
    expect(by).toEqual({
      "/": "info",
      "/ohje/": "info",
      "/palvelut/b/": "warning",
    });
  });
  it("warning that never blocks launch when required is empty (R15)", async () => {
    const site = await siteFrom(files, cfg([]));
    const dev = await runRules(site, [missingTarget], site.config, "dev");
    expect(dev.map((x) => x.url)).toEqual([
      "/",
      "/ohje/",
      "/palvelut/a/",
      "/palvelut/b/",
    ]);
    expect(new Set(dev.map((x) => x.severity))).toEqual(new Set(["warning"]));
    const launch = await runRules(site, [missingTarget], site.config, "launch");
    expect(launch).toHaveLength(4);
    expect(new Set(launch.map((x) => x.severity))).toEqual(
      new Set(["warning"]),
    );
  });
  it("required pages become errors in launch", async () => {
    const site = await siteFrom(
      files,
      cfg([], { targets: { required: ["/palvelut/*"], pages: [] } }),
    );
    const launch = await runRules(site, [missingTarget], site.config, "launch");
    expect(
      launch.filter((x) => x.severity === "error").map((x) => x.url),
    ).toEqual(["/palvelut/a/", "/palvelut/b/"]);
  });
});
