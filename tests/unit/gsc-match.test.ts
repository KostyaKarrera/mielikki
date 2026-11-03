import { describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config/schema.js";
import type { QueryRow } from "../../src/gsc/api.js";
import { matchQueriesToTargets } from "../../src/gsc/match.js";
import { getLang } from "../../src/lang/index.js";

const row = (
  query: string,
  page: string,
  impressions: number,
  position = 5,
): QueryRow => ({
  query,
  page,
  clicks: 1,
  impressions,
  ctr: 0.1,
  position,
});

const config = (pages: object[]) =>
  parseConfig({ language: "fi", targets: { pages } });

const fi = getLang("fi");

describe("matchQueriesToTargets", () => {
  const cfg = config([
    { url: "/loviisa/", primary: "sähköasennukset loviisa" },
  ]);

  it("matches Finnish case forms and word order, not other towns", () => {
    const [t] = matchQueriesToTargets(
      [
        row("sähköasennus loviisassa", "https://example.fi/loviisa/", 10),
        row("loviisan sähköasennukset", "https://example.fi/loviisa", 30),
        row("sähköasennus porvoo", "https://example.fi/loviisa/", 99),
      ],
      cfg,
      fi,
    );
    expect(t?.matched.map((r) => r.query)).toEqual([
      "loviisan sähköasennukset",
      "sähköasennus loviisassa",
    ]);
    expect(t?.impressions).toBe(40);
    expect(t?.clicks).toBe(2);
    expect(t?.status).toBe("ranking");
  });

  it("other-page when matches only point elsewhere; no-data without matches", () => {
    const [a] = matchQueriesToTargets(
      [row("sähköasennus loviisa", "https://example.fi/", 5, 12)],
      cfg,
      fi,
    );
    expect(a?.status).toBe("other-page");
    expect(a?.bestPosition).toBe(12);
    const [b] = matchQueriesToTargets(
      [row("sähköasennus porvoo", "/loviisa/", 5)],
      cfg,
      fi,
    );
    expect(b?.status).toBe("no-data");
    expect(b?.bestPosition).toBeNull();
    expect(b?.matched).toEqual([]);
  });

  it("sorts by impressions desc then query asc", () => {
    const [t] = matchQueriesToTargets(
      [
        row("loviisa sähköasennukset b", "/loviisa/", 5),
        row("loviisa sähköasennukset a", "/loviisa/", 5),
        row("loviisa sähköasennukset c", "/loviisa/", 9),
      ],
      cfg,
      fi,
    );
    expect(t?.matched.map((r) => r.query)).toEqual([
      "loviisa sähköasennukset c",
      "loviisa sähköasennukset a",
      "loviisa sähköasennukset b",
    ]);
  });

  it("honours TargetPage.forms", () => {
    const c = config([
      {
        url: "/",
        primary: "sähkömies",
        forms: { sähkömies: ["sähköasentaja"] },
      },
    ]);
    const [t] = matchQueriesToTargets([row("sähköasentaja", "/", 3)], c, fi);
    expect(t?.status).toBe("ranking");
  });

  it("an empty primary never matches", () => {
    const c = config([{ url: "/", primary: "" }]);
    const [t] = matchQueriesToTargets([row("mitä tahansa", "/", 3)], c, fi);
    expect(t?.status).toBe("no-data");
  });

  it("otherPages names distinct competing URLs, sorted, top 3", () => {
    const [t] = matchQueriesToTargets(
      [
        row("loviisa sähköasennukset", "https://example.fi/z/", 9),
        row("loviisa sähköasennus", "https://example.fi/b/", 8),
        row("sähköasennus loviisassa", "https://example.fi/b/", 7),
        row("loviisan sähköasennukset", "https://example.fi/a/", 6),
        row("loviisa sähköasennuksia", "https://example.fi/c/", 5),
        row("loviisa sähköasennukset hinta", "/loviisa/", 4),
      ],
      cfg,
      fi,
    );
    expect(t?.status).toBe("ranking");
    expect(t?.otherPages).toEqual([
      "https://example.fi/a/",
      "https://example.fi/b/",
      "https://example.fi/c/",
    ]);
  });

  it("different words without forms do not match (sähkömies vs sähköasentaja)", () => {
    const c = config([{ url: "/", primary: "sähkömies" }]);
    const [t] = matchQueriesToTargets([row("sähköasentaja", "/", 3)], c, fi);
    expect(t?.status).toBe("no-data");
  });

  it("documented prefix-compound behaviour: a primary matches longer compounds of it (sähköasennus -> sähköasennuslupa)", () => {
    // stemsMatch accepts near-equal stems (shared prefix >= len-2); this is the
    // accepted trade-off for Finnish inflection, so such a compound counts as a match.
    const c = config([{ url: "/", primary: "sähköasennus" }]);
    const [t] = matchQueriesToTargets([row("sähköasennuslupa", "/", 3)], c, fi);
    expect(t?.matched.map((r) => r.query)).toEqual(["sähköasennuslupa"]);
  });
});
