import { describe, expect, it } from "vitest";
import { pageFrom } from "../helpers.js";

const HEAD = `<!doctype html><html lang="fi"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sähkötyöt Loviisa</title>
<meta name="description" content="Kuvaus">
<link rel="canonical" href="https://example.fi/">
<meta name="robots" content="NoIndex, follow">
<link rel="alternate" hreflang="fi" href="https://example.fi/">
<meta property="og:title" content="OG otsikko">
<meta name="twitter:card" content="summary">
</head><body><header><a href="/a/">Nav</a></header><nav>NAVTEXT <a href="/b/">B</a></nav>
<main><h1>Otsikko</h1><p>  </p><p>Eka   kappale</p><a href="https://x.com/" rel="nofollow noopener">Ulk</a>
<a href="mailto:a@b.fi">m</a><a href="tel:+358 40 123">t</a>
<img src="/i.png" alt="" width="10" loading="lazy"><img src="/j.png"></main>
<footer>FOOT</footer></body></html>`;

describe("parsePage", () => {
  it("extracts head", () => {
    const p = pageFrom(HEAD);
    expect(p.title).toBe("Sähkötyöt Loviisa");
    expect(p.metaDescription).toBe("Kuvaus");
    expect(p.canonical).toBe("https://example.fi/");
    expect(p.canonicalCount).toBe(1);
    expect(p.robotsMeta).toEqual(["noindex", "follow"]);
    expect(p.og).toEqual({ "og:title": "OG otsikko" });
    expect(p.twitter).toEqual({ "twitter:card": "summary" });
    expect(p.lang).toBe("fi");
    expect(p.charset).toBe("utf-8");
    expect(p.viewport).toBe("width=device-width, initial-scale=1");
    expect(p.hreflang).toEqual([{ lang: "fi", href: "https://example.fi/" }]);
    expect(p.headings).toEqual([{ level: 1, text: "Otsikko" }]);
  });

  it("counts duplicates", () => {
    const p = pageFrom("<head><title>a</title><title>b</title></head>");
    expect(p.titleCount).toBe(2);
  });

  it("main text excludes chrome", () => {
    const p = pageFrom(HEAD);
    expect(p.mainText).not.toContain("NAVTEXT");
    expect(p.mainText).not.toContain("FOOT");
    expect(p.firstParagraph).toBe("Eka kappale");
    const q = pageFrom(
      "<body><nav>NAV</nav><p>hei maailma</p><script>var x</script></body>",
    );
    expect(q.mainText).toBe("hei maailma");
    expect(q.wordCount).toBe(2);
  });

  it("links flagged inChrome", () => {
    const p = pageFrom(HEAD);
    const by = (h: string) => p.links.find((l) => l.href === h);
    expect(by("/a/")?.inChrome).toBe(true);
    expect(by("/b/")?.inChrome).toBe(true);
    expect(by("/a/")?.internal).toBe(true);
    expect(by("https://x.com/")?.inChrome).toBe(false);
    expect(by("https://x.com/")?.internal).toBe(false);
    expect(by("https://x.com/")?.rel).toEqual(["nofollow", "noopener"]);
    expect(by("https://x.com/")?.key).toBeUndefined();
  });

  it("link label from aria-label or nested img alt", () => {
    const p = pageFrom(
      '<body><a href="/a/" aria-label=" Etusivu "></a><a href="/b/"><img src="/l.png" alt="Logo"></a><a href="/c/"><img src="/l.png" alt=""></a><a href="/d/">Teksti</a></body>',
    );
    expect(p.links.map((l) => l.label)).toEqual([
      "Etusivu",
      "Logo",
      undefined,
      undefined,
    ]);
  });

  it("images", () => {
    const p = pageFrom(HEAD);
    expect(p.images).toEqual([
      {
        src: "/i.png",
        alt: "",
        width: "10",
        height: undefined,
        loading: "lazy",
        inMain: true,
        index: 0,
      },
      {
        src: "/j.png",
        alt: null,
        width: undefined,
        height: undefined,
        loading: undefined,
        inMain: true,
        index: 1,
      },
    ]);
  });

  it("jsonld parse error kept", () => {
    const p = pageFrom(
      `<script type="application/ld+json">{"a":1}</script><script type="application/ld+json">{bad</script>`,
    );
    expect(p.jsonld[0]?.data).toEqual({ a: 1 });
    expect(p.jsonld[1]?.error).toBeTruthy();
    expect(p.jsonld[1]?.raw).toBe("{bad");
  });

  it("tel normalized", () => {
    const p = pageFrom(HEAD);
    expect(p.tel).toEqual(["+35840123"]);
    expect(p.mailto).toEqual(["a@b.fi"]);
  });

  it("form labelling", () => {
    const p = pageFrom(`<form>
<label for="a">A</label><input id="a" type="text">
<label>W <input type="email"></label>
<input type="text" aria-label="x">
<input type="text" aria-labelledby="a">
<input type="text">
<input type="hidden"><input type="submit"><input type="button">
<textarea></textarea><select></select>
<button>Send</button><button aria-label="Go"></button><button></button>
</form>`);
    expect(p.formControls.map((c) => c.labelled)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(p.formControls.map((c) => c.tag)).toEqual([
      "input",
      "input",
      "input",
      "input",
      "input",
      "textarea",
      "select",
    ]);
    expect(p.buttons).toEqual([
      { named: true },
      { named: true },
      { named: false },
    ]);
  });

  it("tolerates bom/uppercase/unclosed/empty", () => {
    expect(() => pageFrom("﻿<HTML><BODY><P>x")).not.toThrow();
    const p = pageFrom("﻿<HTML><BODY><P>x");
    expect(p.wordCount).toBeGreaterThanOrEqual(1);
    const e = pageFrom("");
    expect(e.wordCount).toBe(0);
    expect(e.title).toBeUndefined();
  });
});

describe("mainText block separation", () => {
  it("separates blocks but keeps inline elements joined", () => {
    const p = pageFrom(
      "<html><body><main><h1>x</h1><p>Foo</p><p>Lovii<b>sa</b></p></main></body></html>",
    );
    expect(p.mainText).toBe("x Foo Loviisa");
    expect(p.headings[0]?.text).toBe("x");
    expect(p.firstParagraph).toBe("Foo");
  });
  it("counts words across blocks", () => {
    expect(
      pageFrom("<html><body><main><h1>a</h1><p>b c</p></main></body></html>")
        .wordCount,
    ).toBe(3);
  });
});
