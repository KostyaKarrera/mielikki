import { describe, expect, it } from "vitest";
import { UsageError } from "../../src/errors.js";
import {
  isAssetPath,
  mapToCrawl,
  normalizeCrawlUrl,
  parseStartUrl,
} from "../../src/net/policy.js";

describe("parseStartUrl", () => {
  it("accepts http(s)", () => {
    expect(parseStartUrl("https://a.fi").href).toBe("https://a.fi/");
    expect(parseStartUrl("http://127.0.0.1:5/x/").href).toBe(
      "http://127.0.0.1:5/x/",
    );
  });

  it("rejects credentials, other schemes and garbage", () => {
    expect(() => parseStartUrl("https://u:p@a.fi")).toThrow(UsageError);
    expect(() => parseStartUrl("https://u@a.fi")).toThrow(UsageError);
    expect(() => parseStartUrl("ftp://a.fi/")).toThrow(UsageError);
    expect(() => parseStartUrl("not a url")).toThrow(UsageError);
  });
});

describe("mapToCrawl", () => {
  it("maps the site origin to the crawl origin", () => {
    expect(
      mapToCrawl(
        "https://unnvsahko.fi/a/",
        "http://127.0.0.1:5",
        "https://unnvsahko.fi",
      ),
    ).toBe("http://127.0.0.1:5/a/");
    expect(
      mapToCrawl(
        "https://unnvsahko.fi/a/?q=1#h",
        "http://127.0.0.1:5",
        "https://unnvsahko.fi/",
      ),
    ).toBe("http://127.0.0.1:5/a/?q=1#h");
  });

  it("leaves other hosts and missing siteOrigin unchanged", () => {
    expect(
      mapToCrawl(
        "https://other.fi/a/",
        "http://127.0.0.1:5",
        "https://unnvsahko.fi",
      ),
    ).toBe("https://other.fi/a/");
    expect(mapToCrawl("https://unnvsahko.fi/a/", "http://127.0.0.1:5")).toBe(
      "https://unnvsahko.fi/a/",
    );
  });
});

describe("normalizeCrawlUrl", () => {
  it("drops the hash and flags the query", () => {
    expect(normalizeCrawlUrl("/a/?x=1#f")).toEqual({
      url: "/a/?x=1",
      query: true,
    });
    expect(normalizeCrawlUrl("http://h/a/#f")).toEqual({
      url: "http://h/a/",
      query: false,
    });
    expect(normalizeCrawlUrl("http://h/a/?")).toEqual({
      url: "http://h/a/",
      query: false,
    });
  });
});

describe("isAssetPath", () => {
  it("recognises asset extensions case-insensitively", () => {
    expect(isAssetPath("/img/a.JPG")).toBe(true);
    expect(isAssetPath("/site.webmanifest")).toBe(true);
    expect(isAssetPath("/doc.pdf")).toBe(true);
    expect(isAssetPath("/palvelut/")).toBe(false);
    expect(isAssetPath("/a.html")).toBe(false);
    expect(isAssetPath("/v1.2/")).toBe(false);
  });
});
