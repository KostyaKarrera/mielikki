import { describe, expect, it } from "vitest";
import { allRules } from "../../../src/rules/all.js";
import { rule as hreflang } from "../../../src/rules/i18n/hreflang.js";
import { rule as imagesAltMissing } from "../../../src/rules/images/alt-missing.js";
import { rule as imagesBroken } from "../../../src/rules/images/broken.js";
import { rule as imagesDimensions } from "../../../src/rules/images/dimensions.js";
import { rule as imagesLazy } from "../../../src/rules/images/lazy-above-fold.js";
import { rule as imagesModern } from "../../../src/rules/images/modern-format.js";
import { rule as imagesWeight } from "../../../src/rules/images/weight.js";
import { rule as brokenInternal } from "../../../src/rules/links/broken-internal.js";
import { rule as deadEnd } from "../../../src/rules/links/dead-end.js";
import { rule as emptyAnchor } from "../../../src/rules/links/empty-anchor.js";
import { rule as genericAnchor } from "../../../src/rules/links/generic-anchor.js";
import { rule as insecureExternal } from "../../../src/rules/links/insecure-external.js";
import { rule as trailingSlash } from "../../../src/rules/links/trailing-slash.js";
import { rule as ogImageBroken } from "../../../src/rules/social/og-image-broken.js";
import { rule as ogMissing } from "../../../src/rules/social/og-missing.js";
import { rule as ogUrlMismatch } from "../../../src/rules/social/og-url-mismatch.js";
import { rule as twitterCard } from "../../../src/rules/social/twitter-card.js";
import { runRule, siteFrom } from "../../helpers.js";

const H = "https://example.fi";
const doc = (head = "", body = "<h1>x</h1>") =>
  `<html lang="fi"><head>${head}</head><body><main>${body}</main></body></html>`;
const run = async (
  rule: Parameters<typeof runRule>[0],
  files: Record<string, string | Buffer>,
  cfg = {},
) => runRule(rule, await siteFrom(files, cfg));
const msgs = async (
  rule: Parameters<typeof runRule>[0],
  files: Record<string, string | Buffer>,
  cfg = {},
) => (await run(rule, files, cfg)).map((f) => f.message);
const one = (html: string) => ({ "index.html": html });
const kb = (n: number) => Buffer.alloc(n * 1024);

describe("registry", () => {
  it("registers the 17 links/images/social/i18n rules, sorted", () => {
    const ids = allRules
      .map((r) => r.meta.id)
      .filter((i) => /^(links|images|social|i18n)\//.test(i));
    expect(ids).toHaveLength(17);
    expect([...allRules.map((r) => r.meta.id)]).toEqual(
      allRules.map((r) => r.meta.id).sort(),
    );
  });
});

describe("links/broken-internal", () => {
  const files = (body: string) => ({
    "index.html": doc("", body),
    "a/index.html": doc(),
    "doc.pdf": "x",
  });
  it("fires once per target per page", async () => {
    const f = await run(
      brokenInternal,
      files(
        '<a href="/nope/">1</a><a href="/nope/#x">2</a><a href="/other/">3</a>',
      ),
    );
    expect(f.map((x) => x.url)).toEqual(["/", "/"]);
    expect(f[0]?.severity).toBe("error");
    expect(f.map((x) => x.message).join()).toContain("/nope/");
  });
  it("is launch-blocking metadata", () => {
    expect(brokenInternal.meta.launchBlocking).toBe(true);
  });
  it("silent for pages, assets, mailto, tel, fragments, external", async () => {
    expect(
      await msgs(
        brokenInternal,
        files(
          '<a href="/a/">a</a><a href="/doc.pdf">p</a><a href="mailto:a@b.fi">m</a><a href="tel:+358401">t</a><a href="#top">f</a><a href="https://x.com/z">e</a>',
        ),
      ),
    ).toEqual([]);
  });
  it("does not treat 404.html as an existing page", async () => {
    expect(
      await msgs(brokenInternal, {
        ...files('<a href="/404/">x</a>'),
        "404.html": doc(),
      }),
    ).toHaveLength(1);
  });
});

describe("links/empty-anchor", () => {
  it("fires with no text, label or img alt", async () => {
    expect(
      await msgs(
        emptyAnchor,
        one(
          doc(
            "",
            '<a href="/a/"></a><a href="/b/"><img src="/i.png" alt=""></a>',
          ),
        ),
      ),
    ).toHaveLength(2);
  });
  it("silent with text, aria-label or img alt", async () => {
    expect(
      await msgs(
        emptyAnchor,
        one(
          doc(
            "",
            '<a href="/a/">Hi</a><a href="/b/" aria-label="B"></a><a href="/c/"><img src="/i.png" alt="C"></a>',
          ),
        ),
      ),
    ).toEqual([]);
  });
});

describe("links/generic-anchor", () => {
  it("fires on generic Finnish text", async () => {
    expect(
      await msgs(
        genericAnchor,
        one(doc("", '<a href="/a/">Lue lisää</a><a href="/b/"> Tästä! </a>')),
        { language: "fi" },
      ),
    ).toHaveLength(2);
  });
  it("silent on descriptive text", async () => {
    expect(
      await msgs(
        genericAnchor,
        one(doc("", '<a href="/a/">Sähköasennukset</a>')),
        {
          language: "fi",
        },
      ),
    ).toEqual([]);
  });
});

describe("links/dead-end", () => {
  it("fires when content has no internal links (chrome links do not count)", async () => {
    const f = await run(deadEnd, {
      "index.html": doc("", '<a href="/a/">a</a>'),
      "a/index.html": `<html><body><nav><a href="/">home</a></nav><main><p>x</p></main></body></html>`,
    });
    expect(f.map((x) => x.url)).toEqual(["/a/"]);
  });
  it("silent when linked; skips noindex pages", async () => {
    expect(
      await run(deadEnd, {
        "index.html": doc("", '<a href="/a/">a</a>'),
        "a/index.html": doc("", '<a href="/">home</a>'),
        "b/index.html": doc('<meta name="robots" content="noindex">'),
      }),
    ).toEqual([]);
  });
});

describe("links/insecure-external", () => {
  it("fires on external http://", async () => {
    expect(
      await msgs(
        insecureExternal,
        one(doc("", '<a href="http://x.com/a">x</a>')),
      ),
    ).toHaveLength(1);
  });
  it("silent on https and internal", async () => {
    expect(
      await msgs(
        insecureExternal,
        one(doc("", '<a href="https://x.com/">x</a><a href="/a/">a</a>')),
      ),
    ).toEqual([]);
  });
});

describe("links/trailing-slash", () => {
  const page =
    '<a href="/a">a</a><a href="/b/">b</a><a href="/c.pdf">c</a><a href="/d/?x=1">d</a>';
  const files = {
    "index.html": doc("", page),
    "a/index.html": doc(),
    "b/index.html": doc(),
    "d/index.html": doc(),
    "c.pdf": "x",
  };
  it("always: flags links without slash", async () => {
    expect(
      await msgs(trailingSlash, files, { input: { trailingSlash: "always" } }),
    ).toEqual([expect.stringContaining('"/a"')]);
  });
  it("never: flags links with slash, not root", async () => {
    const m = await msgs(
      trailingSlash,
      { ...files, "index.html": doc("", `${page}<a href="/">home</a>`) },
      { input: { trailingSlash: "never" } },
    );
    expect(m).toHaveLength(2);
    expect(m.join()).toContain('"/b/"');
    expect(m.join()).toContain('"/d/?x=1"');
  });
  it("ignore: does nothing", async () => {
    expect(await msgs(trailingSlash, files)).toEqual([]);
  });
  it("does nothing for any policy other than always|never", async () => {
    const site = await siteFrom(files);
    (site.config.input as { trailingSlash: string }).trailingSlash = "bogus";
    expect(await runRule(trailingSlash, site)).toEqual([]);
  });
});

describe("images/broken", () => {
  it("fires for missing internal file", async () => {
    const f = await run(imagesBroken, {
      "index.html": doc("", '<img src="/img/x.jpg" alt="">'),
      "img/y.jpg": "x",
    });
    expect(f).toHaveLength(1);
    expect(imagesBroken.meta.launchBlocking).toBe(true);
  });
  it("silent for existing, external and data images", async () => {
    expect(
      await msgs(imagesBroken, {
        "index.html": doc(
          "",
          '<img src="/img/y.jpg"><img src="https://x.com/a.png"><img src="data:image/gif;base64,AAAA">',
        ),
        "img/y.jpg": "x",
      }),
    ).toEqual([]);
  });
});

describe("images/alt-missing", () => {
  it("fires without alt attribute", async () => {
    expect(
      await msgs(imagesAltMissing, one(doc("", '<img src="/a.png">'))),
    ).toHaveLength(1);
  });
  it("silent with alt, including empty alt", async () => {
    expect(
      await msgs(
        imagesAltMissing,
        one(doc("", '<img src="/a.png" alt=""><img src="/b.png" alt="B">')),
      ),
    ).toEqual([]);
  });
});

describe("images/dimensions", () => {
  it("fires when width or height is missing", async () => {
    expect(
      await msgs(
        imagesDimensions,
        one(doc("", '<img src="/a.png" width="1"><img src="/b.png">')),
      ),
    ).toHaveLength(2);
  });
  it("silent with both", async () => {
    expect(
      await msgs(
        imagesDimensions,
        one(doc("", '<img src="/a.png" width="1" height="2">')),
      ),
    ).toEqual([]);
  });
});

describe("images/weight", () => {
  const files = (n: number) => ({
    "index.html": doc("", '<img src="/a.jpg" alt="">'),
    "a.jpg": kb(n),
  });
  it("> 500 KB is a warning", async () => {
    const f = await run(imagesWeight, files(501));
    expect(f.map((x) => x.severity)).toEqual(["warning"]);
  });
  it("> 200 KB is info", async () => {
    const f = await run(imagesWeight, files(250));
    expect(f.map((x) => x.severity)).toEqual(["info"]);
  });
  it("<= 200 KB is silent; boundary 500 KB is info", async () => {
    expect(await msgs(imagesWeight, files(200))).toEqual([]);
    expect(
      (await run(imagesWeight, files(500))).map((x) => x.severity),
    ).toEqual(["info"]);
  });
});

describe("images/modern-format", () => {
  it("fires for jpg/png > 50 KB", async () => {
    expect(
      await msgs(imagesModern, {
        "index.html": doc("", '<img src="/a.JPG"><img src="/b.png">'),
        "a.JPG": kb(60),
        "b.png": kb(51),
      }),
    ).toHaveLength(2);
  });
  it("silent for small jpg, webp and svg", async () => {
    expect(
      await msgs(imagesModern, {
        "index.html": doc(
          "",
          '<img src="/a.jpg"><img src="/b.webp"><img src="/c.svg">',
        ),
        "a.jpg": kb(50),
        "b.webp": kb(300),
        "c.svg": kb(100),
      }),
    ).toEqual([]);
  });
});

describe("images/lazy-above-fold", () => {
  it("fires when the first main image is lazy", async () => {
    expect(
      await msgs(imagesLazy, one(doc("", '<img src="/a.png" loading="lazy">'))),
    ).toHaveLength(1);
  });
  it("silent when first is eager or only a later image is lazy", async () => {
    expect(
      await msgs(
        imagesLazy,
        one(doc("", '<img src="/a.png"><img src="/b.png" loading="lazy">')),
      ),
    ).toEqual([]);
  });
  it("silent when the first image is outside main", async () => {
    expect(
      await msgs(
        imagesLazy,
        one(
          `<html><body><header><img src="/l.png" loading="lazy"></header><main><img src="/b.png" loading="lazy"></main></body></html>`,
        ),
      ),
    ).toEqual([]);
  });
});

describe("social/og-missing", () => {
  const og =
    '<meta property="og:title" content="T"><meta property="og:description" content="D"><meta property="og:image" content="/i.png">';
  it("fires listing missing tags", async () => {
    const m = await msgs(
      ogMissing,
      one(doc('<meta property="og:title" content="T">')),
    );
    expect(m).toEqual(["Missing og:description, og:image"]);
  });
  it("silent when complete, and on noindex pages", async () => {
    expect(await msgs(ogMissing, one(doc(og)))).toEqual([]);
    expect(
      await msgs(ogMissing, one(doc('<meta name="robots" content="noindex">'))),
    ).toEqual([]);
  });
});

describe("social/og-image-broken", () => {
  it("fires for missing internal og:image", async () => {
    expect(
      await msgs(
        ogImageBroken,
        {
          "index.html": doc(`<meta property="og:image" content="${H}/og.png">`),
        },
        { site: H },
      ),
    ).toHaveLength(1);
  });
  it("silent for existing, external or absent", async () => {
    expect(
      await msgs(
        ogImageBroken,
        {
          "index.html": doc(`<meta property="og:image" content="${H}/og.png">`),
          "og.png": "x",
        },
        { site: H },
      ),
    ).toEqual([]);
    expect(
      await msgs(
        ogImageBroken,
        one(doc('<meta property="og:image" content="https://cdn.com/o.png">')),
      ),
    ).toEqual([]);
  });
});

describe("social/og-url-mismatch", () => {
  const head = (og: string) =>
    `<link rel="canonical" href="${H}/"><meta property="og:url" content="${og}">`;
  it("fires on mismatch", async () => {
    expect(
      await msgs(ogUrlMismatch, one(doc(head(`${H}/other/`))), { site: H }),
    ).toHaveLength(1);
  });
  it("silent on match or missing og:url", async () => {
    expect(
      await msgs(ogUrlMismatch, one(doc(head(`${H}/`))), { site: H }),
    ).toEqual([]);
    expect(
      await msgs(
        ogUrlMismatch,
        one(doc(`<link rel="canonical" href="${H}/">`)),
        { site: H },
      ),
    ).toEqual([]);
  });
});

describe("social/twitter-card", () => {
  it("fires when missing", async () => {
    expect(await msgs(twitterCard, one(doc()))).toHaveLength(1);
  });
  it("silent when present or noindex", async () => {
    expect(
      await msgs(
        twitterCard,
        one(doc('<meta name="twitter:card" content="summary">')),
      ),
    ).toEqual([]);
    expect(
      await msgs(
        twitterCard,
        one(doc('<meta name="robots" content="noindex">')),
      ),
    ).toEqual([]);
  });
});

describe("i18n/hreflang", () => {
  const alt = (l: string, h: string) =>
    `<link rel="alternate" hreflang="${l}" href="${h}">`;
  const full = [
    alt("fi", `${H}/`),
    alt("en", `${H}/en/`),
    alt("x-default", `${H}/`),
  ].join("");
  const cfg = { site: H };
  it("silent for a complete reciprocal set", async () => {
    expect(
      await msgs(
        hreflang,
        { "index.html": doc(full), "en/index.html": doc(full) },
        cfg,
      ),
    ).toEqual([]);
  });
  it("fires on invalid code", async () => {
    expect(
      await msgs(hreflang, one(doc(alt("english", `${H}/`))), cfg),
    ).toEqual([expect.stringContaining('"english"')]);
  });
  it("fires when target page is missing", async () => {
    const m = await msgs(
      hreflang,
      one(
        doc(
          alt("fi", `${H}/`) +
            alt("en", `${H}/en/`) +
            alt("x-default", `${H}/`),
        ),
      ),
      cfg,
    );
    expect(m).toEqual([expect.stringContaining("does not exist")]);
  });
  it("fires without return link", async () => {
    const m = await msgs(
      hreflang,
      { "index.html": doc(full), "en/index.html": doc() },
      cfg,
    );
    expect(m).toEqual([expect.stringContaining("does not link back")]);
  });
  it("fires without x-default for >= 2 languages, not for one", async () => {
    const two = alt("fi", `${H}/`) + alt("en", `${H}/en/`);
    expect(
      await msgs(
        hreflang,
        { "index.html": doc(two), "en/index.html": doc(two) },
        cfg,
      ),
    ).toEqual([
      expect.stringContaining("no x-default"),
      expect.stringContaining("no x-default"),
    ]);
    expect(await msgs(hreflang, one(doc(alt("fi", `${H}/`))), cfg)).toEqual([]);
  });
  it("accepts codes and x-default in any letter case", async () => {
    const mixed = [
      alt("FI", `${H}/`),
      alt("en-GB", `${H}/en/`),
      alt("X-Default", `${H}/`),
    ].join("");
    expect(
      await msgs(
        hreflang,
        { "index.html": doc(mixed), "en/index.html": doc(mixed) },
        cfg,
      ),
    ).toEqual([]);
  });
  it("silent without hreflang", async () => {
    expect(await msgs(hreflang, one(doc()), cfg)).toEqual([]);
  });
});
