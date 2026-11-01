import { describe, expect, it } from "vitest";
import { allRules } from "../../../src/rules/all.js";
import { rule as nameConsistency } from "../../../src/rules/local/name-consistency.js";
import { rule as phoneConsistency } from "../../../src/rules/local/phone-consistency.js";
import { rule as swapTest } from "../../../src/rules/local/swap-test.js";
import { rule as telLink } from "../../../src/rules/local/tel-link.js";
import { runRule, siteFrom } from "../../helpers.js";

const doc = (body: string, head = "") =>
  `<html lang="fi"><head>${head}</head><body><main><h1>x</h1>${body}</main></body></html>`;
const business = (extra = {}) => ({
  business: {
    type: "service-area" as const,
    schemaType: "Electrician",
    name: "Sähkö Oy",
    areaServed: ["Loviisa", "Porvoo"],
    hasReviews: false,
    ...extra,
  },
});
const run = async (
  rule: Parameters<typeof runRule>[0],
  files: Record<string, string>,
  cfg = {},
) => runRule(rule, await siteFrom(files, cfg));

describe("registry", () => {
  it("registers the 4 local rules", () => {
    expect(allRules.filter((r) => r.meta.id.startsWith("local/"))).toHaveLength(
      4,
    );
  });
});

describe("local/phone-consistency", () => {
  it("fires once when two distinct numbers are used", async () => {
    const f = await run(phoneConsistency, {
      "index.html": doc('<a href="tel:+358 40 111 2222">a</a>'),
      "b/index.html": doc('<a href="tel:0401112222">a</a>'),
    });
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain("+358401112222");
  });
  it("does not fire for equivalent numbers (00 prefix)", async () => {
    const f = await run(phoneConsistency, {
      "index.html": doc('<a href="tel:+358401112222">a</a>'),
      "b/index.html": doc('<a href="tel:00358401112222">a</a>'),
    });
    expect(f).toEqual([]);
  });
});

describe("local/tel-link", () => {
  const cfg = business({ phone: "+358 40 111 2222" });
  it("fires when the phone is text without any tel: link", async () => {
    const f = await run(
      telLink,
      { "index.html": doc("<p>Soita 040 111 2222 tai +358 40 111 2222</p>") },
      cfg,
    );
    expect(f).toHaveLength(1);
  });
  it("fires when the phone is only in the footer text", async () => {
    const html = `<html lang="fi"><body><main><h1>x</h1></main><footer>Puh. +358 40 111 2222</footer></body></html>`;
    expect(await run(telLink, { "index.html": html }, cfg)).toHaveLength(1);
  });
  it("is silent when the footer phone has a tel: link", async () => {
    const html = `<html lang="fi"><body><main><h1>x</h1></main><footer><a href="tel:+358401112222">040 111 2222</a></footer></body></html>`;
    expect(await run(telLink, { "index.html": html }, cfg)).toEqual([]);
  });
  it("does not fire with a tel: link, or without business", async () => {
    expect(
      await run(
        telLink,
        {
          "index.html": doc(
            '<p>+358 40 111 2222</p><a href="tel:+358401112222">x</a>',
          ),
        },
        cfg,
      ),
    ).toEqual([]);
    expect(
      await run(telLink, { "index.html": doc("<p>+358 40 111 2222</p>") }),
    ).toEqual([]);
  });
});

describe("local/name-consistency", () => {
  it("fires when the name occurs nowhere", async () => {
    const f = await run(
      nameConsistency,
      { "index.html": doc("<p>Jokin teksti</p>") },
      business(),
    );
    expect(f).toHaveLength(1);
  });
  it("does not fire when the name occurs (case/whitespace-insensitive)", async () => {
    expect(
      await run(
        nameConsistency,
        { "index.html": doc("<p>Tervetuloa: sähkö   OY palvelee</p>") },
        business(),
      ),
    ).toEqual([]);
    expect(
      await run(nameConsistency, { "index.html": doc("<p>x</p>") }),
    ).toEqual([]);
  });
});

describe("local/swap-test", () => {
  // A city word every second token: nearly every 5-gram contains one.
  const body = (city: string, tag = "w") =>
    doc(
      `<p>${Array.from({ length: 24 }, (_, i) => `${city} ${tag}${i}`).join(" ")}</p>`,
    );
  const pair = {
    "alueet/loviisa/index.html": body("Loviisassa"),
    "alueet/porvoo/index.html": body("Porvoossa"),
  };
  it("fires for pages differing only by the city", async () => {
    const f = await run(swapTest, pair, business());
    expect(f).toHaveLength(1);
    expect(f[0]?.url).toBe("/alueet/loviisa/");
    expect(f[0]?.message).toContain("/alueet/porvoo/");
  });
  it("needs the swap: unrelated areaServed gives no finding", async () => {
    expect(
      await run(swapTest, pair, business({ areaServed: ["Kotka"] })),
    ).toEqual([]);
  });
  it("does not fire for genuinely different pages", async () => {
    const f = await run(
      swapTest,
      {
        "alueet/loviisa/index.html": body("Loviisassa", "a"),
        "alueet/porvoo/index.html": body("Porvoossa", "b"),
      },
      business(),
    );
    expect(f).toEqual([]);
  });
  it("does not fire with fewer than two pages under the masks", async () => {
    const f = await run(
      swapTest,
      {
        "alueet/loviisa/index.html": body("Loviisassa"),
        "muu/index.html": body("Porvoossa"),
      },
      business(),
    );
    expect(f).toEqual([]);
  });
  it("is silent without areaServed", async () => {
    expect(await run(swapTest, pair, business({ areaServed: [] }))).toEqual([]);
  });
  it("matches multi-word areas as a whole, not per token", async () => {
    const two = {
      "alueet/a/index.html": body("Etelä Pohjanmaalla"),
      "alueet/b/index.html": body("Etelä Pohjanmaan"),
    };
    // "Etelä Pohjanmaa" is one city: the pair collapses to the same text.
    expect(
      await run(swapTest, two, business({ areaServed: ["Etelä Pohjanmaa"] })),
    ).toHaveLength(1);
    // "etelä" alone must not count as a city: pages differing in "etelä" stay apart.
    const iso = {
      "alueet/a/index.html": body("etelä"),
      "alueet/b/index.html": body("pieni"),
    };
    expect(
      await run(swapTest, iso, business({ areaServed: ["Etelä Pohjanmaa"] })),
    ).toEqual([]);
  });
});
