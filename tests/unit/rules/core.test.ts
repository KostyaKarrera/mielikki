import { describe, expect, it } from "vitest";
import { allRules } from "../../../src/rules/all.js";
import { rule as canonicalInvalid } from "../../../src/rules/core/canonical-invalid.js";
import { rule as canonicalMissing } from "../../../src/rules/core/canonical-missing.js";
import { rule as charsetMissing } from "../../../src/rules/core/charset-missing.js";
import { rule as descriptionDuplicate } from "../../../src/rules/core/description-duplicate.js";
import { rule as descriptionLength } from "../../../src/rules/core/description-length.js";
import { rule as descriptionMissing } from "../../../src/rules/core/description-missing.js";
import { rule as descriptionRepeatsTitle } from "../../../src/rules/core/description-repeats-title.js";
import { rule as h1Missing } from "../../../src/rules/core/h1-missing.js";
import { rule as h1Multiple } from "../../../src/rules/core/h1-multiple.js";
import { rule as headingSkip } from "../../../src/rules/core/heading-skip.js";
import { rule as langMismatch } from "../../../src/rules/core/lang-mismatch.js";
import { rule as langMissing } from "../../../src/rules/core/lang-missing.js";
import { rule as titleDuplicate } from "../../../src/rules/core/title-duplicate.js";
import { rule as titleLength } from "../../../src/rules/core/title-length.js";
import { rule as titleMissing } from "../../../src/rules/core/title-missing.js";
import { rule as titleMultiple } from "../../../src/rules/core/title-multiple.js";
import { rule as viewportMissing } from "../../../src/rules/mobile/viewport-missing.js";
import { rule as zoomDisabled } from "../../../src/rules/mobile/zoom-disabled.js";
import { runRule, siteFrom } from "../../helpers.js";

const H = "https://example.fi";
const T30 = "Sähkötyöt ja asennukset Helsingissä"; // 35 chars
const D130 =
  "Kokenut sähköasentaja tekee asennukset, korjaukset ja tarkastukset nopeasti ja luotettavasti koko pääkaupunkiseudulla. Pyydä tarjous!";
const page = (head = "", body = "<h1>x</h1>", htmlAttrs = ' lang="fi"') =>
  `<!doctype html><html${htmlAttrs}><head><meta charset="utf-8">${head}</head><body><main>${body}</main></body></html>`;
const msgs = async (
  rule: Parameters<typeof runRule>[0],
  files: Record<string, string>,
  cfg = {},
) => (await runRule(rule, await siteFrom(files, cfg))).map((f) => f.message);
const one = (html: string) => ({ "index.html": html });
const fires = async (
  rule: Parameters<typeof runRule>[0],
  html: string,
  cfg = {},
) => expect(await msgs(rule, one(html), cfg)).toHaveLength(1);
const silent = async (
  rule: Parameters<typeof runRule>[0],
  html: string,
  cfg = {},
) => expect(await msgs(rule, one(html), cfg)).toEqual([]);
const NOINDEX = '<meta name="robots" content="noindex">';

describe("core/mobile registry", () => {
  it("registers all 18 rules, sorted", () => {
    const ids = allRules.map((r) => r.meta.id);
    expect(ids.filter((i) => /^(core|mobile)\//.test(i))).toHaveLength(18);
    expect(ids).toEqual([...ids].sort());
  });
});

describe("core/title-missing", () => {
  it("fires without title", () => fires(titleMissing, page()));
  it("fires on empty title", () =>
    fires(titleMissing, page("<title> </title>")));
  it("silent with title", () =>
    silent(titleMissing, page("<title>Hi</title>")));
  it("silent on noindex page", () => silent(titleMissing, page(NOINDEX)));
  it("is launch blocking", () =>
    expect(titleMissing.meta.launchBlocking).toBe(true));
});

describe("core/title-multiple", () => {
  it("fires with two titles", () =>
    fires(titleMultiple, page("<title>A</title><title>B</title>")));
  it("silent with one", () => silent(titleMultiple, page("<title>A</title>")));
});

describe("core/title-length", () => {
  it("fires when too short", () =>
    fires(titleLength, page("<title>Short</title>")));
  it("fires when too long", () =>
    fires(titleLength, page(`<title>${"a".repeat(61)}</title>`)));
  it("silent in range", () =>
    silent(titleLength, page(`<title>${T30}</title>`)));
  it("counts code points, not UTF-16 units", () => {
    // 30 chars of ä (each 1 code point) and 30 astral emoji (60 UTF-16 units)
    return Promise.all([
      silent(titleLength, page(`<title>${"ä".repeat(30)}</title>`)),
      silent(titleLength, page(`<title>${"😀".repeat(30)}</title>`)),
    ]);
  });
  it("honours min/max options", () =>
    silent(titleLength, page("<title>Short</title>"), {
      rules: { options: { "core/title-length": { min: 3, max: 10 } } },
    }));
  it("silent on noindex page", () =>
    silent(titleLength, page(`${NOINDEX}<title>x</title>`)));
});

describe("core/title-duplicate", () => {
  const files = (a: string, b: string, extra = "") => ({
    "index.html": page(`<title>${a}</title>`),
    "b/index.html": page(`<title>${b}</title>${extra}`),
  });
  it("fires per page, naming the others", async () => {
    const out = await runRule(
      titleDuplicate,
      await siteFrom(files("Hello  World", " hello world")),
    );
    expect(out.map((f) => f.url)).toEqual(["/", "/b/"]);
    expect(out[0]?.message).toContain("/b/");
  });
  it("silent when titles differ", async () =>
    expect(await msgs(titleDuplicate, files("A", "B"))).toEqual([]));
  it("ignores non-indexable pages", async () =>
    expect(await msgs(titleDuplicate, files("A", "A", NOINDEX))).toEqual([]));
});

describe("core/description-missing", () => {
  it("fires without description", () => fires(descriptionMissing, page()));
  it("silent with description", () =>
    silent(descriptionMissing, page('<meta name="description" content="x">')));
  it("silent on noindex page", () => silent(descriptionMissing, page(NOINDEX)));
});

describe("core/description-length", () => {
  const d = (s: string) => page(`<meta name="description" content="${s}">`);
  it("fires when short", () => fires(descriptionLength, d("short")));
  it("fires when long", () => fires(descriptionLength, d("a".repeat(161))));
  it("silent in range", () => silent(descriptionLength, d(D130)));
  it("silent without description", () => silent(descriptionLength, page()));
});

describe("core/description-duplicate", () => {
  const files = (a: string, b: string) => ({
    "index.html": page(`<meta name="description" content="${a}">`),
    "b/index.html": page(`<meta name="description" content="${b}">`),
  });
  it("fires per page", async () => {
    const out = await runRule(
      descriptionDuplicate,
      await siteFrom(files("Same  text", "same text")),
    );
    expect(out.map((f) => f.url)).toEqual(["/", "/b/"]);
  });
  it("silent when different", async () =>
    expect(await msgs(descriptionDuplicate, files("a", "b"))).toEqual([]));
});

describe("core/description-repeats-title", () => {
  const p = (t: string, d: string) =>
    page(`<title>${t}</title><meta name="description" content="${d}">`);
  it("fires when description starts with title", () =>
    fires(
      descriptionRepeatsTitle,
      p("Sähkötyöt", "sähkötyöt Helsingissä nopeasti"),
    ));
  it("silent otherwise", () =>
    silent(descriptionRepeatsTitle, p("Sähkötyöt", "Nopeat sähkötyöt")));
});

describe("core/h1-missing", () => {
  it("fires without H1", () => fires(h1Missing, page("", "<h2>x</h2>")));
  it("silent with H1", () => silent(h1Missing, page()));
});

describe("core/h1-multiple", () => {
  it("fires with two H1", () =>
    fires(h1Multiple, page("", "<h1>a</h1><h1>b</h1>")));
  it("silent with one", () => silent(h1Multiple, page()));
});

describe("core/heading-skip", () => {
  it("fires on H2 to H4", () =>
    fires(headingSkip, page("", "<h1>a</h1><h2>b</h2><h4>c</h4>")));
  it("silent for sequential and for going back up", () =>
    silent(headingSkip, page("", "<h1>a</h1><h2>b</h2><h3>c</h3><h2>d</h2>")));
});

describe("core/canonical-missing", () => {
  it("fires without canonical", () => fires(canonicalMissing, page()));
  it("silent with canonical", () =>
    silent(canonicalMissing, page(`<link rel="canonical" href="${H}/">`), {
      site: H,
    }));
  it("silent on noindex page", () => silent(canonicalMissing, page(NOINDEX)));
});

describe("core/canonical-invalid", () => {
  const c = (...hrefs: string[]) =>
    page(hrefs.map((h) => `<link rel="canonical" href="${h}">`).join(""));
  it("fires with two canonicals", () =>
    fires(canonicalInvalid, c(`${H}/`, `${H}/a/`), { site: H }));
  it("fires on relative canonical", () =>
    fires(canonicalInvalid, c("/a/"), { site: H }));
  it("fires on foreign host", () =>
    fires(canonicalInvalid, c("https://other.fi/"), { site: H }));
  it("silent on valid absolute canonical", () =>
    silent(canonicalInvalid, c(`${H}/`), { site: H }));
  it("silent without canonical", () =>
    silent(canonicalInvalid, page(), { site: H }));
  it("is launch blocking", () =>
    expect(canonicalInvalid.meta.launchBlocking).toBe(true));
});

describe("core/lang-missing", () => {
  it("fires without lang", () =>
    fires(langMissing, page("", "<h1>x</h1>", "")));
  it("silent with lang", () => silent(langMissing, page()));
});

describe("core/lang-mismatch", () => {
  it("fires when primary subtag differs", () =>
    fires(langMismatch, page("", "<h1>x</h1>", ' lang="en-GB"'), {
      language: "fi",
    }));
  it("silent when primary subtag matches", () =>
    silent(langMismatch, page("", "<h1>x</h1>", ' lang="fi-FI"'), {
      language: "fi",
    }));
  it("silent without lang attribute", () =>
    silent(langMismatch, page("", "<h1>x</h1>", ""), { language: "fi" }));
});

describe("core/charset-missing", () => {
  it("fires without charset", () =>
    fires(
      charsetMissing,
      "<html lang='fi'><head></head><body><h1>x</h1></body></html>",
    ));
  it("silent with charset", () => silent(charsetMissing, page()));
});

describe("mobile/viewport-missing", () => {
  it("fires without viewport", () => fires(viewportMissing, page()));
  it("silent with viewport", () =>
    silent(
      viewportMissing,
      page(
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
      ),
    ));
});

describe("mobile/zoom-disabled", () => {
  const v = (c: string) => page(`<meta name="viewport" content="${c}">`);
  it("fires on user-scalable=no", () =>
    fires(zoomDisabled, v("width=device-width, user-scalable=no")));
  it("fires on user-scalable=0", () =>
    fires(zoomDisabled, v("width=device-width,user-scalable=0")));
  it("fires on maximum-scale=1", () =>
    fires(zoomDisabled, v("width=device-width, maximum-scale=1.0")));
  it("silent on maximum-scale=2 and plain viewport", async () => {
    await silent(zoomDisabled, v("width=device-width, maximum-scale=2"));
    await silent(zoomDisabled, v("width=device-width, initial-scale=1"));
  });
  it("silent without viewport", () => silent(zoomDisabled, page()));
});
