import { describe, expect, it } from "vitest";
import { getLang } from "../../src/lang/index.js";
import { phraseIn, stemsMatch } from "../../src/lang/match.js";

describe("stemsMatch", () => {
  it("equal and prefix rule", () => {
    expect(stemsMatch("helsink", "helsing")).toBe(true);
    expect(stemsMatch("sähköasennus", "sähköasennuks")).toBe(true);
    expect(stemsMatch("asennus", "asentaj")).toBe(false);
    expect(stemsMatch("abc", "abc")).toBe(true);
  });
});

describe("getLang", () => {
  it("resolves codes", () => {
    expect(getLang("fi-FI").code).toBe("fi");
    expect(getLang("sv").code).toBe("sv");
    expect(getLang("xx").code).toBe("other");
    expect(getLang().code).toBe("other");
  });
});

describe("sv", () => {
  const sv = getLang("sv");
  it("Lovisa ~ i Lovisa", () => {
    expect(phraseIn("Lovisa", "elektriker i Lovisa", sv)).toBe("full");
  });
  it("stopwords and none", () => {
    expect(phraseIn("elektriker och Lovisa", "elektriker Lovisa", sv)).toBe(
      "full",
    );
    expect(phraseIn("tak", "elektriker Lovisa", sv)).toBe("none");
  });
});

describe("en", () => {
  const en = getLang("en");
  it("electrician ~ electricians", () => {
    expect(phraseIn("electrician", "Local electricians", en)).toBe("full");
  });
  it("none", () => {
    expect(phraseIn("plumber", "Local electricians", en)).toBe("none");
  });
});

describe("phraseIn details", () => {
  const en = getLang("en");
  it("compound check needs a stem of at least 4 chars", () => {
    expect(phraseIn("car", "carpets for sale", en)).toBe("none");
    expect(phraseIn("bulb", "lightbulbs for sale", en)).toBe("partial");
  });
  it("forms keys are normalized (case, NFC)", () => {
    expect(phraseIn("foo", "a bar here", en, { FOO: ["bar"] })).toBe("full");
    const decomposed = "Åland"; // Å as A + combining ring
    expect(
      phraseIn("Åland", "ahvenanmaa", en, { [decomposed]: ["ahvenanmaa"] }),
    ).toBe("full");
  });
});
