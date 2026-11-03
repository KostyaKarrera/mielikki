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

  it("is linear in the number of sibling blocks (<p>)", () => {
    const run = (n: number): number => {
      const html = `<html><body><main>${"<p>sana</p>".repeat(n)}</main></body></html>`;
      const t = performance.now();
      const p = pageFrom(html);
      expect(p.wordCount).toBe(n);
      return performance.now() - t;
    };
    run(2_000); // warm-up
    const small = run(5_000);
    const big = run(20_000);
    // 4x the input must not cost anywhere near 16x (quadratic); generous for loaded machines
    expect(big).toBeLessThan(Math.max(small, 20) * 12);
  }, 30_000);
  it("handles deep nesting below the cap without recursion limits", () => {
    const html = `<html><body><main>${"<div>".repeat(1_400)}x${"</div>".repeat(1_400)}</main></body></html>`;
    expect(pageFrom(html).mainText).toBe("x");
  }, 30_000);
  it("separates br and ignores script/noscript text", () => {
    const p = pageFrom(
      "<html><body><main>a<br>b<script>var z=1</script><noscript>NS</noscript></main></body></html>",
    );
    expect(p.mainText).toBe("a b");
  });
});

describe("robots meta", () => {
  const head = (m: string) =>
    pageFrom(`<html><head>${m}</head><body></body></html>`).robotsMeta;
  it("'none' means noindex, nofollow", () => {
    expect(head('<meta name="robots" content="none">')).toEqual([
      "noindex",
      "nofollow",
    ]);
  });
  it("merges googlebot meta and dedupes", () => {
    expect(
      head(
        '<meta name="robots" content="follow"><meta name="GoogleBot" content="noindex, follow">',
      ),
    ).toEqual(["follow", "noindex"]);
  });
  it("ignores metas for other bots", () => {
    expect(head('<meta name="bingbot" content="noindex">')).toEqual([]);
  });
});

describe("parsePage resources", () => {
  it("collects resources in document order", () => {
    const p = pageFrom(`<!doctype html><html><head>
<script src="/a.js"></script><script>inline()</script>
<link rel="stylesheet" href="/s.css">
<link rel="preload" as="script" href="/p.js">
<link rel="preload" as="style" href="/p.css">
<link rel="preload" as="font" href="/f.woff2">
<link rel="modulepreload" href="/m.js">
</head><body><iframe src="/f.html"></iframe>
<video src="/v.mp4"><source src="/v.webm"></video><audio src="/a.mp3"></audio>
</body></html>`);
    expect(p.resources).toEqual([
      { kind: "script", src: "/a.js" },
      { kind: "style", src: "/s.css" },
      { kind: "script", src: "/p.js" },
      { kind: "style", src: "/p.css" },
      { kind: "other", src: "/f.woff2" },
      { kind: "script", src: "/m.js" },
      { kind: "iframe", src: "/f.html" },
      { kind: "media", src: "/v.mp4" },
      { kind: "media", src: "/v.webm" },
      { kind: "media", src: "/a.mp3" },
    ]);
  });

  it("is empty for a page without resources", () => {
    expect(pageFrom("<p>x</p>").resources).toEqual([]);
  });
});
