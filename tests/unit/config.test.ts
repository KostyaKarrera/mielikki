import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { loadConfig } from "../../src/config/load.js";
import { ConfigError, parseConfig } from "../../src/config/schema.js";

const SPEC_YAML = `
site: https://example.fi
language: fi
region: FI
prelaunch: true
input:
  dir: dist
  trailingSlash: always
business:
  type: service-area
  schemaType: Electrician
  name: Example Sähkö Oy
  phone: "+358 …"
  areaServed: [Loviisa, Porvoo, Helsinki, Uusimaa]
  hasReviews: false
exclude:
  noindexExpected: [/kiitos/, /404/]
placeholders: [MALLITEKSTI, lorem ipsum]
testContacts:
  phones: ['^\\+?358 ?40 ?000']
  emails: ['@example\\.']
targets:
  required: [/, /palvelut/*, /alueet/*]
  pages:
    - url: /palvelut/sahkoasennukset/
      primary: sähköasennukset loviisa
      secondary: [sähköasentaja loviisa, sähkömies porvoo]
      forms: { helsinki: [helsingissä, helsingin] }
    - url: /alueet/
      primary: sähköasentaja itä-uusimaa
rules:
  disable: [images/modern-format]
  severity: { content/word-count: info }
`;

function errorOf(fn: () => unknown): ConfigError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    return e as ConfigError;
  }
  throw new Error("expected ConfigError");
}

describe("config", () => {
  it("parses spec example", () => {
    const cfg = parseConfig(parse(SPEC_YAML));
    expect(cfg.targets.required).toEqual(["/", "/palvelut/*", "/alueet/*"]);
    expect(cfg.business?.hasReviews).toBe(false);
    expect(cfg.language).toBe("fi");
    expect(cfg.input.trailingSlash).toBe("always");
    expect(cfg.targets.pages[1]?.secondary).toEqual([]);
    expect(cfg.targets.pages[1]?.forms).toEqual({});
    expect(cfg.testContacts.phones).toContain("^\\+?358 ?40 ?000");
  });

  it("rejects the removed input.cleanUrls option", () => {
    expect(() => parseConfig({ input: { cleanUrls: true } })).toThrow(
      /input\.cleanUrls/,
    );
  });

  it("applies defaults", () => {
    const cfg = parseConfig({});
    expect(cfg.prelaunch).toBe(false);
    expect(cfg.input).toEqual({
      dir: "dist",
      trailingSlash: "ignore",
    });
    expect(cfg.targets.pages).toEqual([]);
    expect(cfg.rules.enable).toEqual([]);
    expect(cfg.exclude).toEqual({ noindexExpected: [], ignore: [] });
    expect(cfg.business).toBeUndefined();
  });

  it("adds built-in test contacts to configured ones", () => {
    const base = parseConfig({});
    expect(base.testContacts.phones).toEqual([
      "^\\+?0+$",
      "123 ?456 ?7",
      "^\\+?358 ?0+$",
    ]);
    expect(base.testContacts.emails).toEqual([
      "@example\\.(com|org|net)$",
      "@test\\.",
      "^test@",
    ]);
    const cfg = parseConfig({ testContacts: { emails: ["^foo@", "^test@"] } });
    expect(cfg.testContacts.emails).toEqual([
      ...base.testContacts.emails,
      "^foo@",
    ]);
  });

  it("rejects unknown key", () => {
    expect(errorOf(() => parseConfig({ sitee: "x" })).path).toBe("sitee");
  });

  it("rejects unknown nested key", () => {
    expect(errorOf(() => parseConfig({ input: { dr: "x" } })).path).toBe(
      "input.dr",
    );
  });

  it("rejects wrong type with path", () => {
    const err = errorOf(() =>
      parseConfig({ targets: { pages: [{ url: 5 }] } }),
    );
    expect(err.path).toBe("targets.pages.0.url");
  });

  it("rejects non-object root", () => {
    expect(errorOf(() => parseConfig("x")).path).toBe("");
  });

  it("site trailing slash stripped", () => {
    expect(parseConfig({ site: "https://a.fi/" }).site).toBe("https://a.fi");
    expect(parseConfig({ site: "https://a.fi//" }).site).toBe("https://a.fi");
  });

  it("rejects non-absolute site", () => {
    expect(errorOf(() => parseConfig({ site: "a.fi" })).path).toBe("site");
  });
});

describe("loadConfig", () => {
  async function tmp(): Promise<string> {
    return mkdtemp(join(tmpdir(), "mielikki-cfg-"));
  }

  it("returns defaults when no file", async () => {
    const cfg = await loadConfig(await tmp());
    expect(cfg.input.dir).toBe("dist");
  });

  it("loads yaml and yml", async () => {
    const a = await tmp();
    await writeFile(join(a, "mielikki.config.yaml"), "region: FI\n");
    expect((await loadConfig(a)).region).toBe("FI");
    const b = await tmp();
    await writeFile(join(b, "mielikki.config.yml"), "region: SE\n");
    expect((await loadConfig(b)).region).toBe("SE");
  });

  it("bad yaml → ConfigError with path '' and line number", async () => {
    const dir = await tmp();
    await writeFile(
      join(dir, "mielikki.config.yaml"),
      "site: ok\nfoo: [unclosed\n",
    );
    const err = await loadConfig(dir).catch((e) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect(err.path).toBe("");
    expect(err.message).toMatch(/line \d+/i);
  });

  it("empty file gives defaults", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "mielikki.config.yaml"), "");
    expect((await loadConfig(dir)).prelaunch).toBe(false);
  });

  it("explicit path missing → ConfigError", async () => {
    const dir = await tmp();
    const err = await loadConfig(dir, "nope.yaml").catch((e) => e);
    expect(err).toBeInstanceOf(ConfigError);
  });
});
