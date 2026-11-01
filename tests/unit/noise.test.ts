import { describe, expect, it } from "vitest";
import { allRules } from "../../src/rules/all.js";
import { runRules } from "../../src/rules/engine.js";
import { selectRules } from "../../src/rules/registry.js";
import { siteFrom } from "../helpers.js";

const N = 200;
const H = "https://example.fi";
const text = Array.from({ length: 450 }, (_, i) => `sana${i}`).join(" ");
const DESC =
  "Sama kuvaus kaikilla sivuilla, joka on tarpeeksi pitkä mutta toistuu sellaisenaan jokaisella kloonatulla sivulla ilman muutoksia.";
const clone = (key: string) => `<!doctype html><html lang="fi"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sama otsikko kaikilla sivuilla | Yritys Oy</title>
<meta name="description" content="${DESC}">
<link rel="canonical" href="${H}${key}">
<meta property="og:title" content="Sama otsikko"><meta property="og:description" content="${DESC}">
<meta property="og:image" content="${H}/og.jpg"><meta name="twitter:card" content="summary_large_image">
</head><body><main><h1>Sama otsikko</h1><p>${text}</p><p><a href="/">Etusivu</a></p></main></body></html>`;

describe("noise budget (R18)", () => {
  it(`${N} cloned pages give O(N) findings`, async () => {
    const files: Record<string, string> = {};
    const keys = Array.from({ length: N }, (_, i) => `/sivu-${i}/`);
    files["index.html"] = clone("/").replace(
      "</main>",
      `${keys.map((k) => `<a href="${k}">${k}</a>`).join(" ")}</main>`,
    );
    for (const k of keys) files[`${k.slice(1)}index.html`] = clone(k);
    files["og.jpg"] = "x";
    const site = await siteFrom(files, { site: H, language: "fi" });
    const started = performance.now();
    const findings = await runRules(
      site,
      selectRules(allRules, site.config),
      site.config,
      "launch",
    );
    const ms = performance.now() - started;
    const pages = N + 1;
    // per-page rules (here targets/missing-target) give at most one finding per page
    expect(findings.length).toBeLessThan(2 * pages);
    // the pairwise and duplicate rules each report one group, not N^2 pairs
    for (const id of [
      "content/near-duplicate",
      "core/title-duplicate",
      "core/description-duplicate",
    ])
      expect(
        findings.filter((f) => f.ruleId === id),
        id,
      ).toHaveLength(1);
    expect(ms).toBeLessThan(20_000);
  }, 60_000);
});
