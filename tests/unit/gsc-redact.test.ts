import { describe, expect, it } from "vitest";
import { redact } from "../../src/gsc/redact.js";

describe("redact", () => {
  it("replaces every occurrence of secrets of length >= 6", () => {
    expect(redact("a SECRET1 b SECRET1 c", ["SECRET1"])).toBe(
      "a [скрыто] b [скрыто] c",
    );
  });
  it("ignores short secrets and empty strings", () => {
    expect(redact("abc12 x", ["abc12", ""])).toBe("abc12 x");
  });
  it("also hides URL-encoded forms", () => {
    expect(redact("v=a%2Fb%2Fc%2Fd", ["a/b/c/d"])).toBe("v=[скрыто]");
  });
});
