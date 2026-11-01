import { describe, expect, it } from "vitest";
import { clusterPairs, percentRange } from "../../src/rules/_cluster.js";

describe("clusterPairs", () => {
  it("joins connected pairs into sorted groups", () => {
    const groups = clusterPairs([
      { a: "/d/", b: "/e/", similarity: 0.95 },
      { a: "/c/", b: "/a/", similarity: 0.9 },
      { a: "/b/", b: "/c/", similarity: 0.93 },
    ]);
    expect(groups).toEqual([
      { pages: ["/a/", "/b/", "/c/"], min: 0.9, max: 0.93 },
      { pages: ["/d/", "/e/"], min: 0.95, max: 0.95 },
    ]);
  });
  it("does not depend on pair order", () => {
    const pairs = [
      { a: "/x/", b: "/y/", similarity: 0.7 },
      { a: "/a/", b: "/y/", similarity: 0.8 },
      { a: "/m/", b: "/n/", similarity: 0.9 },
      { a: "/n/", b: "/a/", similarity: 0.6 },
    ];
    expect(clusterPairs([...pairs].reverse())).toEqual(clusterPairs(pairs));
    expect(clusterPairs(pairs)).toHaveLength(1);
  });
  it("formats the similarity range", () => {
    expect(percentRange({ pages: [], min: 0.9, max: 0.9 })).toBe("90%");
    expect(percentRange({ pages: [], min: 0.9, max: 0.954 })).toBe("90–95%");
  });
});
