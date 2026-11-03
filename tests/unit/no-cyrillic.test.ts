import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Files under src/ allowed to contain Cyrillic (none so far; add with a reason). */
const ALLOWLIST: string[] = [];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
}

describe("runtime messages", () => {
  it("src has no Cyrillic text (CLI messages are English)", () => {
    const bad = walk("src")
      .filter((f) => !ALLOWLIST.includes(f))
      .filter((f) => /\p{Script=Cyrillic}/u.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
});
