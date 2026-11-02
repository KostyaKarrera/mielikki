import { describe, expect, it } from "vitest";
import { rule as imagesBroken } from "../../../src/rules/images/broken.js";
import { rule as brokenInternal } from "../../../src/rules/links/broken-internal.js";
import { rule as pageMissing } from "../../../src/rules/targets/page-missing.js";
import { html, load, O, runRule } from "./http/_util.js";

const target = (url: string) => ({
  targets: { pages: [{ url, primary: "x" }] },
});

describe("URL mode: broken is decided from site.responses", () => {
  it("links/broken-internal: a link that was never requested (query, robots) is silent", async () => {
    const s = await load({
      [`${O}/`]: html(
        '<a href="/haku/?q=1">h</a><a href="/yksityinen/">y</a><a href="/puuttuu/">p</a>',
      ),
      [`${O}/robots.txt`]: {
        html: "User-agent: *\nDisallow: /yksityinen/\n",
        headers: { "content-type": "text/plain" },
      },
    });
    const f = await runRule(brokenInternal, s);
    expect(f.map((x) => x.message)).toEqual([
      'Link "/puuttuu/" points to /puuttuu/, which does not exist',
    ]);
  });

  it("links/broken-internal: timeout and 5xx are broken, a redirect loop is not", async () => {
    const s = await load({
      [`${O}/`]: html(
        '<a href="/hidas/">h</a><a href="/virhe/">v</a><a href="/silmukka/">s</a>',
      ),
      [`${O}/hidas/`]: { stop: "timeout", detail: "exceeded 10 ms" },
      [`${O}/virhe/`]: { html: "x", status: 500 },
      [`${O}/silmukka/`]: {
        hops: [{ url: `${O}/silmukka/`, status: 301, location: "/silmukka/" }],
        stop: "redirect-loop",
      },
    });
    const f = await runRule(brokenInternal, s);
    expect(f.map((x) => x.message)).toEqual([
      'Link "/hidas/" points to /hidas/, which did not answer (timeout)',
      'Link "/virhe/" points to /virhe/, which answers HTTP 500',
    ]);
  });

  it("links/broken-internal: a link to the 404 target of another URL's redirect is broken", async () => {
    const s = await load({
      [`${O}/`]: html('<a href="/a/">a</a><a href="/b/">b</a>'),
      [`${O}/a/`]: {
        hops: [{ url: `${O}/a/`, status: 301, location: `${O}/c/` }],
        final: { url: `${O}/c/`, status: 404, headers: {}, bytes: 0 },
      },
      [`${O}/b/`]: html('<a href="/c/">c</a>'),
    });
    const f = await runRule(brokenInternal, s);
    expect(f.map((x) => x.message)).toEqual([
      'Link "/a/" points to /a/, which does not exist',
      'Link "/c/" points to /c/, which does not exist',
    ]);
  });

  it("images/broken: an image over the asset budget is silent; a 404 image is broken", async () => {
    const s = await load(
      {
        [`${O}/`]: html('<img src="/a.jpg" alt="a"><img src="/b.jpg" alt="b">'),
      },
      {},
      `${O}/`,
      { maxAssets: 1 },
    );
    const f = await runRule(imagesBroken, s);
    expect(f.map((x) => x.message)).toEqual([
      'Image "/a.jpg" (/a.jpg) does not exist',
    ]);
  });

  it("targets/page-missing: silent when the page limit cut the crawl", async () => {
    const script = {
      [`${O}/`]: html('<a href="/a/">a</a><a href="/b/">b</a>'),
      [`${O}/a/`]: html("a"),
      [`${O}/b/`]: html("b"),
    };
    const cut = await load(script, target("/b/"), `${O}/`, { maxPages: 2 });
    expect(await runRule(pageMissing, cut)).toEqual([]);
    const full = await load(script, target("/c/"));
    expect((await runRule(pageMissing, full)).map((x) => x.url)).toEqual([
      "/c/",
    ]);
  });

  it("targets/page-missing: silent for a target skipped by --respect-robots", async () => {
    const s = await load(
      {
        [`${O}/`]: html('<a href="/yksityinen/">y</a>'),
        [`${O}/robots.txt`]: {
          html: "User-agent: *\nDisallow: /yksityinen/\n",
          headers: { "content-type": "text/plain" },
        },
      },
      target("/yksityinen/"),
    );
    expect(await runRule(pageMissing, s)).toEqual([]);
  });
});
