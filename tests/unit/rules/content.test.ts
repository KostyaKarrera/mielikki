import { describe, expect, it } from "vitest";
import { allRules } from "../../../src/rules/all.js";
import { rule as keywordStuffing } from "../../../src/rules/content/keyword-stuffing.js";
import { rule as nearDuplicate } from "../../../src/rules/content/near-duplicate.js";
import { rule as placeholder } from "../../../src/rules/content/placeholder.js";
import { rule as testContact } from "../../../src/rules/content/test-contact.js";
import { rule as wordCount } from "../../../src/rules/content/word-count.js";
import { runRule, siteFrom } from "../../helpers.js";

const doc = (body: string, head = "") =>
  `<html lang="fi"><head>${head}</head><body><main><h1>Otsikko</h1> ${body}</main></body></html>`;
const words = (n: number, w = "sana") => Array(n).fill(w).join(" ");
const msgs = async (
  rule: Parameters<typeof runRule>[0],
  files: Record<string, string>,
  cfg = {},
) => (await runRule(rule, await siteFrom(files, cfg))).map((f) => f.message);
const one = (html: string) => ({ "index.html": html });

describe("registry", () => {
  it("registers the 5 content rules", () => {
    expect(
      allRules.filter((r) => r.meta.id.startsWith("content/")),
    ).toHaveLength(5);
  });
});

describe("content/placeholder", () => {
  it("fires on built-ins in text, title and og, once per marker", async () => {
    const m = await msgs(
      placeholder,
      one(
        doc(
          "<p>Lorem Ipsum dolor. TODO fix</p>",
          '<title>TBD</title><meta property="og:title" content="todo">',
        ),
      ),
    );
    expect(m).toHaveLength(3);
    expect(m.find((x) => x.includes("TODO"))).toContain("og:title");
  });
  it("matches config markers with punctuation but not inside words", async () => {
    const cfg = { placeholders: ["MALLITEKSTI", "a.b"] };
    expect(
      await msgs(placeholder, one(doc("<p>MALLITEKSTI: tähän</p>")), cfg),
    ).toHaveLength(1);
    expect(
      await msgs(placeholder, one(doc("<p>xMALLITEKSTIx axb</p>")), cfg),
    ).toEqual([]);
  });
  it("does not fire on clean pages or on 'todos'", async () => {
    expect(await msgs(placeholder, one(doc("<p>Sähkötyöt todos</p>")))).toEqual(
      [],
    );
  });
  it("fires on image alt", async () => {
    expect(
      await msgs(placeholder, one(doc('<img src="a.jpg" alt="placeholder">'))),
    ).toHaveLength(1);
  });
});

describe("content/test-contact", () => {
  it("fires on test tel, mailto and text contacts", async () => {
    const m = await msgs(
      testContact,
      one(
        doc(
          '<a href="tel:+358 0000000">x</a><a href="mailto:test@firma.fi">m</a><p>Mail: me@example.com</p>',
        ),
      ),
    );
    expect(m).toHaveLength(3);
  });
  it("flags tel that differs from business phone, ignoring spaces and 00", async () => {
    const business = {
      type: "service-area",
      schemaType: "Electrician",
      name: "V",
      phone: "+358 40 123 4568",
    };
    expect(
      await msgs(testContact, one(doc('<a href="tel:+358401111111">x</a>')), {
        business,
      }),
    ).toHaveLength(1);
    expect(
      await msgs(
        testContact,
        one(doc('<a href="tel:00358 40 1234568">x</a>')),
        { business },
      ),
    ).toEqual([]);
  });
  it("does nothing about business phone without business; invalid regex is skipped", async () => {
    expect(
      await msgs(testContact, one(doc('<a href="tel:+358401111111">x</a>'))),
    ).toEqual([]);
    expect(
      await msgs(testContact, one(doc("<p>ok</p>")), {
        testContacts: { phones: ["("], emails: [] },
      }),
    ).toEqual([]);
  });
});

describe("content/word-count", () => {
  it("fires below 250 and uses 400 for required pages", async () => {
    expect(
      await msgs(wordCount, one(doc(`<p>${words(100)}</p>`))),
    ).toHaveLength(1);
    const files = one(doc(`<p>${words(300)}</p>`));
    expect(await msgs(wordCount, files)).toEqual([]);
    expect(
      await msgs(wordCount, files, { targets: { required: ["/"], pages: [] } }),
    ).toHaveLength(1);
  });
  it("skips non-indexable pages", async () => {
    expect(
      await msgs(
        wordCount,
        one(doc("<p>short</p>", '<meta name="robots" content="noindex">')),
      ),
    ).toEqual([]);
  });
});

describe("content/near-duplicate", () => {
  const text = Array.from({ length: 80 }, (_, i) => `w${i}`).join(" ");
  it("fires once per pair on the smaller key", async () => {
    const f = await runRule(
      nearDuplicate,
      await siteFrom({
        "a/index.html": doc(`<p>${text}</p>`),
        "b/index.html": doc(`<p>${text} lisää</p>`),
      }),
    );
    expect(f).toHaveLength(1);
    expect(f[0]?.url).toBe("/a/");
    expect(f[0]?.message).toContain("/b/");
  });
  it("does not fire on different or short pages", async () => {
    const other = Array.from({ length: 80 }, (_, i) => `x${i}`).join(" ");
    expect(
      await msgs(nearDuplicate, {
        "a/index.html": doc(`<p>${text}</p>`),
        "b/index.html": doc(`<p>${other}</p>`),
        "c/index.html": doc("<p>lyhyt</p>"),
        "d/index.html": doc("<p>lyhyt</p>"),
      }),
    ).toEqual([]);
  });
});

describe("content/keyword-stuffing", () => {
  const cfg = {
    targets: {
      required: [],
      pages: [{ url: "/", primary: "sähkötyöt", secondary: [], forms: {} }],
    },
  };
  it("fires when a primary stem dominates", async () => {
    const body = `<p>${words(12, "sähkötyöt")} ${words(100)}</p>`;
    expect(await msgs(keywordStuffing, one(doc(body)), cfg)).toHaveLength(1);
  });
  it("does not fire on normal density, few occurrences, or non-target pages", async () => {
    expect(
      await msgs(
        keywordStuffing,
        one(doc(`<p>${words(5, "sähkötyöt")} ${words(100)}</p>`)),
        cfg,
      ),
    ).toEqual([]);
    expect(
      await msgs(
        keywordStuffing,
        one(doc(`<p>${words(12, "sähkötyöt")} ${words(500)}</p>`)),
        cfg,
      ),
    ).toEqual([]);
    expect(
      await msgs(keywordStuffing, one(doc(`<p>${words(40, "sähkötyöt")}</p>`))),
    ).toEqual([]);
  });
});
