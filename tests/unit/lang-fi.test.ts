import { describe, expect, it } from "vitest";
import { getLang } from "../../src/lang/index.js";
import { phraseIn, stemsMatch } from "../../src/lang/match.js";

const fi = getLang("fi-FI");

describe("fi phraseIn", () => {
  it("Loviisa ~ Loviisassa/Loviisan", () => {
    expect(phraseIn("Loviisa", "Sähkötyöt Loviisassa", fi)).toBe("full");
    expect(phraseIn("Loviisa", "Loviisan alue", fi)).toBe("full");
  });
  it("Porvoo ~ Porvoossa", () => {
    expect(phraseIn("Porvoo", "Asennus Porvoossa", fi)).toBe("full");
  });
  it("Helsinki ~ Helsingissä via prefix", () => {
    expect(phraseIn("Helsinki", "Töitä Helsingissä", fi)).toBe("full");
  });
  it("sähköasennus ~ sähköasennukset", () => {
    expect(phraseIn("sähköasennus", "Sähköasennukset taloihin", fi)).toBe(
      "full",
    );
  });
  it("asentaja in sähköasentajan is partial (compound)", () => {
    expect(phraseIn("asentaja", "Kokenut sähköasentajan palvelu", fi)).toBe(
      "partial",
    );
  });
  it("asennus vs asentaja do not match", () => {
    expect(stemsMatch(fi.stem("asennus"), fi.stem("asentaja"))).toBe(false);
  });
  it("forms override", () => {
    expect(phraseIn("mies", "Kolme miehen työtä", fi)).toBe("none");
    expect(
      phraseIn("mies", "Kolme miehen työtä", fi, { mies: ["miehen"] }),
    ).toBe("full");
  });
  it("stopwords ignored", () => {
    expect(
      phraseIn("sähköasentaja ja loviisa", "sähköasentaja loviisa", fi),
    ).toBe("full");
  });
  it("itä-uusimaa tokenized", () => {
    expect(fi.tokenize("Itä-Uusimaa")).toEqual(["itä", "uusimaa"]);
    expect(phraseIn("itä-uusimaa", "Palvelemme Itä-Uusimaalla", fi)).toBe(
      "full",
    );
  });
  it("phrase none", () => {
    expect(phraseIn("kattoremontti", "Sähköasennukset Loviisassa", fi)).toBe(
      "none",
    );
  });
});
