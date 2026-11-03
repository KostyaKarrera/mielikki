import { describe, expect, it } from "vitest";
import { allRules } from "../../../src/rules/all.js";
import { rule as canonicalTarget } from "../../../src/rules/crawl/canonical-target.js";
import { rule as depth } from "../../../src/rules/crawl/depth.js";
import { rule as noindex } from "../../../src/rules/crawl/noindex.js";
import { rule as noindexExpectedMissing } from "../../../src/rules/crawl/noindex-expected-missing.js";
import { rule as orphan } from "../../../src/rules/crawl/orphan.js";
import { rule as pageTooDeep } from "../../../src/rules/crawl/page-too-deep.js";
import { rule as pageUnparseable } from "../../../src/rules/crawl/page-unparseable.js";
import { rule as robotsBlocksAll } from "../../../src/rules/crawl/robots-blocks-all.js";
import { rule as robotsBlocksAssets } from "../../../src/rules/crawl/robots-blocks-assets.js";
import { rule as robotsBlocksPage } from "../../../src/rules/crawl/robots-blocks-page.js";
import { rule as robotsMissing } from "../../../src/rules/crawl/robots-missing.js";
import { rule as robotsNoSitemap } from "../../../src/rules/crawl/robots-no-sitemap.js";
import { rule as siteUrlNotConfigured } from "../../../src/rules/crawl/site-url-not-configured.js";
import { rule as sitemapBadEntry } from "../../../src/rules/crawl/sitemap-bad-entry.js";
import { rule as sitemapForeignHost } from "../../../src/rules/crawl/sitemap-foreign-host.js";
import { rule as sitemapInvalid } from "../../../src/rules/crawl/sitemap-invalid.js";
import { rule as sitemapMissing } from "../../../src/rules/crawl/sitemap-missing.js";
import { rule as sitemapMissingPage } from "../../../src/rules/crawl/sitemap-missing-page.js";
import { rule as thinHtml } from "../../../src/rules/crawl/thin-html.js";
import { runRule, siteFrom } from "../../helpers.js";

const H = "https://example.fi";
const doc = (head = "", body = "<h1>x</h1>") =>
  `<html><head>${head}</head><body><main>${body}</main></body></html>`;
const a = (href: string) => `<a href="${href}">link</a>`;
const sitemap = (...urls: string[]) =>
  `<urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`;
const NOINDEX = '<meta name="robots" content="noindex">';
const twoPages = {
  "index.html": doc("", a("/a/")),
  "a/index.html": doc(),
};
const ids = async (
  rule: Parameters<typeof runRule>[0],
  files: Record<string, string>,
  cfg = {},
) =>
  (await runRule(rule, await siteFrom(files, cfg))).map(
    (f) => f.url ?? f.message,
  );

describe("crawl rules registry", () => {
  it("registers all 17 crawl rules, sorted", () => {
    const c = allRules
      .map((r) => r.meta.id)
      .filter((i) => i.startsWith("crawl/"));
    expect(c).toHaveLength(19);
    expect(c).toEqual([...c].sort());
  });
});

describe("crawl/robots-missing", () => {
  it("fires without robots.txt", async () => {
    expect(await ids(robotsMissing, twoPages)).toHaveLength(1);
  });
  it("silent with robots.txt", async () => {
    expect(
      await ids(robotsMissing, {
        ...twoPages,
        "robots.txt": "User-agent: *\nAllow: /",
      }),
    ).toEqual([]);
  });
});

describe("crawl/robots-blocks-all", () => {
  it("fires on Disallow: /", async () => {
    expect(
      await ids(robotsBlocksAll, {
        ...twoPages,
        "robots.txt": "User-agent: *\nDisallow: /",
      }),
    ).toHaveLength(1);
  });
  it("silent when only a section is blocked or no robots", async () => {
    expect(
      await ids(robotsBlocksAll, {
        ...twoPages,
        "robots.txt": "User-agent: *\nDisallow: /a/",
      }),
    ).toEqual([]);
    expect(await ids(robotsBlocksAll, twoPages)).toEqual([]);
  });
});

describe("crawl/robots-blocks-page", () => {
  const robots = "User-agent: *\nDisallow: /a/";
  it("fires for an indexable blocked page", async () => {
    expect(
      await ids(robotsBlocksPage, { ...twoPages, "robots.txt": robots }),
    ).toEqual(["/a/"]);
  });
  it("silent for noindexExpected pages and allowed pages", async () => {
    expect(
      await ids(
        robotsBlocksPage,
        { ...twoPages, "robots.txt": robots },
        { exclude: { noindexExpected: ["/a/"], ignore: [] } },
      ),
    ).toEqual([]);
    expect(await ids(robotsBlocksPage, twoPages)).toEqual([]);
  });
  it("does not fire when robots-blocks-all fires", async () => {
    expect(
      await ids(robotsBlocksPage, {
        ...twoPages,
        "robots.txt": "User-agent: *\nDisallow: /",
      }),
    ).toEqual([]);
  });
  it("fires in prelaunch for a partially blocked page", async () => {
    expect(
      await ids(
        robotsBlocksPage,
        { ...twoPages, "robots.txt": robots },
        { prelaunch: true },
      ),
    ).toEqual(["/a/"]);
  });
});

describe("crawl/robots-blocks-assets", () => {
  const files = {
    "index.html": doc(
      '<link rel="stylesheet" href="/css/app.css"><script src="/js/app.js"></script>',
      '<img src="/img/a.jpg" alt="">',
    ),
    "css/app.css": "a{}",
    "js/app.js": "1",
    "img/a.jpg": "x",
    "img/unused.png": "x",
  };
  it("fires for used css/js/images that are blocked", async () => {
    const out = await ids(robotsBlocksAssets, {
      ...files,
      "robots.txt": "User-agent: *\nDisallow: /css/\nDisallow: /img/",
    });
    expect(out).toHaveLength(2);
    expect(out.join(" ")).not.toContain("unused");
  });
  it("silent when assets are allowed", async () => {
    expect(
      await ids(robotsBlocksAssets, {
        ...files,
        "robots.txt": "User-agent: *\nDisallow: /private/",
      }),
    ).toEqual([]);
  });
});

describe("crawl/robots-blocks-assets (blanket disallow)", () => {
  it("silent when the whole site is disallowed (robots-blocks-all reports it)", async () => {
    expect(
      await ids(robotsBlocksAssets, {
        "index.html": doc('<link rel="stylesheet" href="/css/app.css">'),
        "css/app.css": "a{}",
        "robots.txt": "User-agent: *\nDisallow: /",
      }),
    ).toEqual([]);
  });
});

describe("crawl/robots-no-sitemap", () => {
  it("fires when robots lacks Sitemap line", async () => {
    expect(
      await ids(robotsNoSitemap, {
        ...twoPages,
        "robots.txt": "User-agent: *\nAllow: /",
        "sitemap.xml": sitemap(`${H}/`),
      }),
    ).toHaveLength(1);
  });
  it("silent when there is no sitemap at all (sitemap-missing reports it)", async () => {
    expect(
      await ids(robotsNoSitemap, {
        ...twoPages,
        "robots.txt": "User-agent: *\nAllow: /",
      }),
    ).toEqual([]);
  });
  it("silent with a Sitemap line or without robots", async () => {
    expect(
      await ids(robotsNoSitemap, {
        ...twoPages,
        "robots.txt": `Sitemap: ${H}/sitemap.xml`,
      }),
    ).toEqual([]);
    expect(await ids(robotsNoSitemap, twoPages)).toEqual([]);
  });
});

describe("crawl/sitemap-missing", () => {
  it("fires without sitemap", async () => {
    expect(await ids(sitemapMissing, twoPages)).toHaveLength(1);
  });
  it("silent with sitemap.xml", async () => {
    expect(
      await ids(sitemapMissing, {
        ...twoPages,
        "sitemap.xml": sitemap(`${H}/`),
      }),
    ).toEqual([]);
  });
});

describe("crawl/sitemap-invalid", () => {
  it("fires on broken xml and on empty sitemap", async () => {
    expect(
      await ids(sitemapInvalid, {
        ...twoPages,
        "sitemap.xml": "<urlset><url>",
      }),
    ).toHaveLength(1);
    expect(
      await ids(sitemapInvalid, { ...twoPages, "sitemap.xml": sitemap() }),
    ).toHaveLength(1);
  });
  it("silent on a valid sitemap", async () => {
    expect(
      await ids(sitemapInvalid, {
        ...twoPages,
        "sitemap.xml": sitemap(`${H}/`),
      }),
    ).toEqual([]);
  });
});

describe("crawl/sitemap-foreign-host", () => {
  const cfg = { site: H };
  it("fires on localhost URLs in sitemap", async () => {
    const out = await ids(
      sitemapForeignHost,
      {
        ...twoPages,
        "sitemap.xml": sitemap(`${H}/`, "http://localhost:4321/a/"),
      },
      cfg,
    );
    expect(out).toHaveLength(1);
  });
  it("fires on a foreign Sitemap: line in robots", async () => {
    expect(
      await ids(
        sitemapForeignHost,
        {
          ...twoPages,
          "sitemap.xml": sitemap(`${H}/`),
          "robots.txt": "Sitemap: https://staging.example.fi/sitemap.xml",
        },
        cfg,
      ),
    ).toHaveLength(1);
  });
  it("silent when hosts match or site is unknown", async () => {
    expect(
      await ids(
        sitemapForeignHost,
        { ...twoPages, "sitemap.xml": sitemap(`${H}/`) },
        cfg,
      ),
    ).toEqual([]);
    expect(
      await ids(sitemapForeignHost, {
        ...twoPages,
        "sitemap.xml": sitemap("https://other.fi/"),
      }),
    ).toEqual([]);
  });
  it("fires on local/private hosts even when they are the detected origin", async () => {
    const L = "http://localhost:4321";
    const local = {
      "index.html": doc(`<link rel="canonical" href="${L}/">`, a("/a/")),
      "a/index.html": doc(`<link rel="canonical" href="${L}/a/">`),
      "sitemap.xml": sitemap(`${L}/`, `${L}/a/`),
      "robots.txt": `Sitemap: ${L}/sitemap.xml`,
    };
    const site = await siteFrom(local);
    expect(site.site).toBe(L);
    const out = await runRule(sitemapForeignHost, site);
    expect(out.map((f) => f.message)).toEqual([
      `${L}/ in sitemap is on a local/private host (localhost:4321)`,
      `${L}/a/ in sitemap is on a local/private host (localhost:4321)`,
      `${L}/sitemap.xml in robots.txt is on a local/private host (localhost:4321)`,
    ]);
    for (const h of [
      "http://127.0.0.1:8080",
      "http://[::1]",
      "http://10.1.2.3",
      "http://172.20.0.5",
      "http://192.168.1.10",
      "http://169.254.1.1",
      "http://myhost.local",
      "http://app.localhost",
    ])
      expect(
        await ids(
          sitemapForeignHost,
          { ...twoPages, "sitemap.xml": sitemap(`${h}/`) },
          { site: h },
        ),
        h,
      ).toHaveLength(1);
  });
});

describe("crawl/site-url-not-configured", () => {
  it("fires when config.site is undefined", async () => {
    const out = await runRule(siteUrlNotConfigured, await siteFrom(twoPages));
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe("warning");
    expect(out[0]?.message).toContain("set `site:`");
  });
  it("is an error in launch", async () => {
    const out = await runRule(
      siteUrlNotConfigured,
      await siteFrom(twoPages),
      "launch",
    );
    expect(out[0]?.severity).toBe("error");
  });
  it("silent when site is configured", async () => {
    expect(await ids(siteUrlNotConfigured, twoPages, { site: H })).toEqual([]);
  });
});

describe("crawl/sitemap-missing-page", () => {
  it("fires for an indexable page absent from sitemap", async () => {
    expect(
      await ids(
        sitemapMissingPage,
        { ...twoPages, "sitemap.xml": sitemap(`${H}/`) },
        { site: H },
      ),
    ).toEqual(["/a/"]);
  });
  it("silent when listed, noindexExpected, or no sitemap", async () => {
    expect(
      await ids(
        sitemapMissingPage,
        { ...twoPages, "sitemap.xml": sitemap(`${H}/`, `${H}/a`) },
        { site: H },
      ),
    ).toEqual([]);
    expect(
      await ids(
        sitemapMissingPage,
        { ...twoPages, "sitemap.xml": sitemap(`${H}/`) },
        { site: H, exclude: { noindexExpected: ["/a/"], ignore: [] } },
      ),
    ).toEqual([]);
    expect(await ids(sitemapMissingPage, twoPages)).toEqual([]);
  });
});

describe("crawl/sitemap-bad-entry", () => {
  const files = {
    "index.html": doc("", a("/n/") + a("/c/")),
    "n/index.html": doc(NOINDEX),
    "c/index.html": doc(`<link rel="canonical" href="${H}/">`),
  };
  it("fires for missing, noindex and other-canonical entries", async () => {
    const out = await ids(
      sitemapBadEntry,
      {
        ...files,
        "sitemap.xml": sitemap(`${H}/`, `${H}/gone/`, `${H}/n/`, `${H}/c/`),
      },
      { site: H },
    );
    expect(out).toHaveLength(3);
  });
  it("silent for good entries", async () => {
    expect(
      await ids(
        sitemapBadEntry,
        { ...files, "sitemap.xml": sitemap(`${H}/`) },
        { site: H },
      ),
    ).toEqual([]);
  });
});

describe("crawl/noindex", () => {
  it("fires on noindex page", async () => {
    expect(
      await ids(noindex, { ...twoPages, "a/index.html": doc(NOINDEX) }),
    ).toEqual(["/a/"]);
  });
  it("silent for noindexExpected and normal pages", async () => {
    expect(
      await ids(
        noindex,
        { ...twoPages, "a/index.html": doc(NOINDEX) },
        { exclude: { noindexExpected: ["/a/"], ignore: [] } },
      ),
    ).toEqual([]);
    expect(await ids(noindex, twoPages)).toEqual([]);
  });
});

describe("crawl/noindex-expected-missing", () => {
  const cfg = { exclude: { noindexExpected: ["/a/"], ignore: [] } };
  it("fires when expected page lacks noindex", async () => {
    expect(await ids(noindexExpectedMissing, twoPages, cfg)).toEqual(["/a/"]);
  });
  it("silent when noindex present", async () => {
    expect(
      await ids(
        noindexExpectedMissing,
        { ...twoPages, "a/index.html": doc(NOINDEX) },
        cfg,
      ),
    ).toEqual([]);
  });
});

describe("crawl/depth", () => {
  const chain = {
    "index.html": doc("", a("/1/")),
    "1/index.html": doc("", a("/2/")),
    "2/index.html": doc("", a("/3/")),
    "3/index.html": doc("", a("/4/")),
    "4/index.html": doc(),
  };
  it("fires for depth > 3", async () => {
    expect(await ids(depth, chain)).toEqual(["/4/"]);
  });
  it("respects maxDepth option and is silent otherwise", async () => {
    expect(
      await ids(depth, chain, {
        rules: { options: { "crawl/depth": { maxDepth: 4 } } },
      }),
    ).toEqual([]);
    expect(await ids(depth, twoPages)).toEqual([]);
  });
});

describe("crawl/orphan", () => {
  it("fires for a page nobody links to", async () => {
    expect(await ids(orphan, { ...twoPages, "o/index.html": doc() })).toEqual([
      "/o/",
    ]);
  });
  it("silent for linked pages and the home page", async () => {
    expect(await ids(orphan, twoPages)).toEqual([]);
  });
});

describe("crawl/canonical-target", () => {
  const link = (h: string) => `<link rel="canonical" href="${h}">`;
  it("fires on missing target and on noindex target", async () => {
    expect(
      await ids(canonicalTarget, {
        ...twoPages,
        "a/index.html": doc(link("/gone/")),
      }),
    ).toEqual(["/a/"]);
    expect(
      await ids(canonicalTarget, {
        "index.html": doc(link("/n/"), a("/n/")),
        "n/index.html": doc(NOINDEX),
      }),
    ).toEqual(["/"]);
  });
  it("silent for self, valid, external canonicals", async () => {
    expect(
      await ids(canonicalTarget, {
        ...twoPages,
        "a/index.html": doc(link("/a/")),
      }),
    ).toEqual([]);
    expect(
      await ids(canonicalTarget, {
        ...twoPages,
        "a/index.html": doc(link("/")),
      }),
    ).toEqual([]);
    expect(
      await ids(
        canonicalTarget,
        {
          ...twoPages,
          "a/index.html": doc(link("https://other.com/x/")),
        },
        { site: H },
      ),
    ).toEqual([]);
  });
});

describe("crawl/thin-html", () => {
  it("fires for near-empty page with script", async () => {
    expect(
      await ids(thinHtml, {
        "index.html": doc(
          "",
          '<div id="root"></div><script src="/app.js"></script>',
        ),
      }),
    ).toEqual(["/"]);
  });
  it("silent without script or with enough words", async () => {
    expect(await ids(thinHtml, { "index.html": doc("", "<p>hi</p>") })).toEqual(
      [],
    );
    const words = Array.from({ length: 40 }, () => "sana").join(" ");
    expect(
      await ids(thinHtml, {
        "index.html": doc("", `<p>${words}</p><script></script>`),
      }),
    ).toEqual([]);
  });
  it("ignores JSON-LD, JSON and module scripts", async () => {
    const head = [
      '<script type="application/ld+json">{"@type":"Thing"}</script>',
      "<script type='application/json'>{}</script>",
      '<script type="module" src="/_astro/hoisted.js"></script>',
      "<script type=MODULE>1</script>",
    ].join("");
    expect(
      await ids(thinHtml, { "index.html": doc(head, "<p>hi</p>") }),
    ).toEqual([]);
    expect(
      await ids(thinHtml, {
        "index.html": doc(`${head}<script type="text/javascript">1</script>`),
      }),
    ).toEqual(["/"]);
  });
  it("judges indexable pages only", async () => {
    const files = {
      "index.html": doc("", a("/kiitos/")),
      "kiitos/index.html": doc(
        "",
        '<p>Kiitos</p><script src="/a.js"></script>',
      ),
    };
    expect(await ids(thinHtml, files)).toEqual(["/kiitos/"]);
    expect(
      await ids(thinHtml, files, {
        exclude: { noindexExpected: ["/kiitos/"] },
      }),
    ).toEqual([]);
  });
});

describe("prelaunch", () => {
  const files = {
    "index.html": doc(NOINDEX, a("/a/")),
    "a/index.html": doc(NOINDEX),
    "robots.txt": "User-agent: *\nDisallow: /",
  };
  const crawl = allRules.filter((r) => r.meta.id.startsWith("crawl/"));
  it("prelaunch site in dev has only info for P rules", async () => {
    const site = await siteFrom(files, { prelaunch: true });
    const { runRules } = await import("../../../src/rules/engine.js");
    const f = await runRules(site, crawl, site.config, "dev");
    const p = new Set(
      crawl.filter((r) => r.meta.prelaunchExpected).map((r) => r.meta.id),
    );
    const hit = f.filter((x) => p.has(x.ruleId));
    expect(hit.map((x) => x.ruleId)).toEqual(
      expect.arrayContaining([
        "crawl/robots-blocks-all",
        "crawl/noindex",
        "crawl/sitemap-missing",
      ]),
    );
    expect(hit.every((x) => x.severity === "info")).toBe(true);
  });
  it("same site in launch is error for blocking rules", async () => {
    const site = await siteFrom(files, { prelaunch: true });
    const { runRules } = await import("../../../src/rules/engine.js");
    const f = await runRules(site, crawl, site.config, "launch");
    const b = new Set(
      crawl.filter((r) => r.meta.launchBlocking).map((r) => r.meta.id),
    );
    const hit = f.filter((x) => b.has(x.ruleId));
    expect(hit.map((x) => x.ruleId)).toEqual(
      expect.arrayContaining([
        "crawl/robots-blocks-all",
        "crawl/noindex",
        "crawl/sitemap-missing",
      ]),
    );
    expect(hit.every((x) => x.severity === "error")).toBe(true);
  });
});

describe("crawl rules skip config target pages (targets/not-indexable reports them)", () => {
  const target = { url: "/a/", primary: "x", secondary: [], forms: {} };
  const cfg = { site: H, targets: { required: [], pages: [target] } };
  it("crawl/noindex", async () => {
    const files = { ...twoPages, "a/index.html": doc(NOINDEX) };
    expect(await ids(noindex, files, { site: H })).toEqual(["/a/"]);
    expect(await ids(noindex, files, cfg)).toEqual([]);
  });
  it("crawl/robots-blocks-page", async () => {
    const files = { ...twoPages, "robots.txt": "User-agent: *\nDisallow: /a/" };
    expect(await ids(robotsBlocksPage, files, { site: H })).toEqual(["/a/"]);
    expect(await ids(robotsBlocksPage, files, cfg)).toEqual([]);
  });
  it("crawl/canonical-target", async () => {
    const files = {
      ...twoPages,
      "a/index.html": doc(`<link rel="canonical" href="${H}/missing/">`),
    };
    expect(await ids(canonicalTarget, files, { site: H })).toEqual(["/a/"]);
    expect(await ids(canonicalTarget, files, cfg)).toEqual([]);
  });
});

describe("robots meta variants reach the crawl rules", () => {
  it("crawl/noindex fires on content=none and on googlebot noindex", async () => {
    for (const m of [
      '<meta name="robots" content="none">',
      '<meta name="googlebot" content="noindex">',
    ])
      expect(
        await ids(noindex, { ...twoPages, "a/index.html": doc(m) }),
        m,
      ).toEqual(["/a/"]);
  });
});

describe("exclude.ignore in sitemap rules", () => {
  it("an ignored page listed in the sitemap is neither gone nor bad", async () => {
    const files = {
      ...twoPages,
      "sitemap.xml": sitemap(`${H}/`, `${H}/a/`),
    };
    const cfg = { site: H, exclude: { noindexExpected: [], ignore: ["/a/"] } };
    expect(await ids(sitemapBadEntry, files, cfg)).toEqual([]);
    expect(await ids(sitemapMissingPage, files, cfg)).toEqual([]);
  });
  it("summary-relevant: ignored pages are not in site.pages", async () => {
    const site = await siteFrom(twoPages, {
      exclude: { noindexExpected: [], ignore: ["/a/"] },
    });
    expect(site.pages.map((p) => p.key)).toEqual(["/"]);
  });
});

describe("crawl/page-too-deep", () => {
  it("reports pages that were refused before parsing", async () => {
    const site = await siteFrom({
      "index.html": doc("", a("/deep/")),
      "deep/index.html": `<main>${"<div>".repeat(5000)}</main>`,
    });
    const f = await runRule(pageTooDeep, site);
    expect(f.map((x) => x.url)).toEqual(["deep/index.html"]);
    expect(f[0]?.message).toContain("page too deeply nested (1501 > 1500)");
    expect(f[0]?.severity).toBe("error");
  });
  it("is silent on normal sites", async () => {
    expect(await ids(pageTooDeep, twoPages)).toEqual([]);
  });
});

describe("crawl/page-unparseable", () => {
  it("reports non-depth reasons only, and page-too-deep the depth ones", async () => {
    const site = await siteFrom(twoPages);
    site.unparsed = [
      { url: "a.html", reason: "timeout" },
      { url: "b.html", reason: "too-deep", depth: 2000 },
    ];
    const u = await runRule(pageUnparseable, site);
    expect(u.map((f) => f.url)).toEqual(["a.html"]);
    expect(u[0]?.message).toContain("(timeout)");
    expect(u[0]?.severity).toBe("error");
    expect((await runRule(pageTooDeep, site)).map((f) => f.url)).toEqual([
      "b.html",
    ]);
  });
});
