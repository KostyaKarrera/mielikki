import { describe, expect, it } from "vitest";
import { alphabetFor, questionTemplates } from "../../src/research/alphabet.js";

describe("alphabetFor", () => {
  it("fi has a-z plus å ä ö", () => {
    const a = alphabetFor("fi");
    expect(a).toHaveLength(29);
    for (const c of ["a", "z", "ä", "ö", "å"]) expect(a).toContain(c);
  });
  it("sv matches fi", () => {
    expect(alphabetFor("sv")).toEqual(alphabetFor("fi"));
  });
  it("en has 26 and is the default", () => {
    expect(alphabetFor("en")).toHaveLength(26);
    expect(alphabetFor(undefined)).toEqual(alphabetFor("en"));
  });
});

describe("questionTemplates", () => {
  it("returns per-language lists", () => {
    expect(questionTemplates("fi")).toEqual([
      "miten",
      "mikä",
      "paljonko",
      "kuinka paljon",
      "mitä maksaa",
      "kuka",
      "missä",
    ]);
    expect(questionTemplates("sv")).toEqual([
      "hur",
      "vad",
      "vem",
      "var",
      "vad kostar",
    ]);
    expect(questionTemplates("en")).toEqual([
      "how",
      "what",
      "how much",
      "who",
      "where",
    ]);
    expect(questionTemplates(undefined)).toEqual(questionTemplates("en"));
  });
});
