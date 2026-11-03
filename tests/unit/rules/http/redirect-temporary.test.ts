import { describe, expect, it } from "vitest";
import { rule } from "../../../../src/rules/http/redirect-temporary.js";
import { html, load, O, redirect, runRule } from "./_util.js";

describe("http/redirect-temporary", () => {
  it("flags content-linked, sitemap and start URLs; 301 and unlinked are silent", async () => {
    const s = await load({
      [`${O}/`]: html(
        '<a href="/t/">t</a><a href="/p/">p</a><a href="/h/">h</a>',
      ),
      [`${O}/t/`]: redirect(`${O}/t/`, 302, `${O}/t2/`),
      [`${O}/p/`]: redirect(`${O}/p/`, 301, `${O}/p2/`),
      [`${O}/h/`]: redirect(`${O}/h/`, 307, `${O}/h2/`),
      [`${O}/sitemap.xml`]: {
        html: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${O}/s/</loc></url></urlset>`,
        headers: { "content-type": "application/xml" },
      },
      [`${O}/s/`]: redirect(`${O}/s/`, 303, `${O}/s2/`),
    });
    const f = await runRule(rule, s);
    expect(f.map((x) => x.url)).toEqual([`${O}/h/`, `${O}/s/`, `${O}/t/`]);
  });
  it("flags the start URL", async () => {
    const s = await load({ [`${O}/`]: redirect(`${O}/`, 302, `${O}/fi/`) });
    expect((await runRule(rule, s)).map((x) => x.url)).toEqual([`${O}/`]);
  });
  it("is silent for a footer-only (chrome) link", async () => {
    const s = await load({
      [`${O}/`]: html('<main>x</main><footer><a href="/t/">t</a></footer>'),
      [`${O}/t/`]: redirect(`${O}/t/`, 302, `${O}/t2/`),
    });
    expect(await runRule(rule, s)).toEqual([]);
    expect(rule.meta.launchBlocking).toBe(false);
  });
});
