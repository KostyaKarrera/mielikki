import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_NESTING, maxOpenDepth } from "../../src/parse/depth.js";
import { PageTooDeepError, parsePage } from "../../src/parse/page.js";
import {
  PageUnparseableError,
  parsePageSafe,
  toUnparseable,
  workerSpawnCount,
} from "../../src/parse/safe.js";

const r = (s: string, k: number): string => s.repeat(k);
const distinctB = (n: number): string =>
  Array.from({ length: n }, (_, i) => `<b a${i}>`).join("");
const fast = { timeoutMs: 500 };

async function reason(html: string, timeoutMs = 500): Promise<string> {
  try {
    await parsePageSafe(html, "/", undefined, { timeoutMs });
  } catch (e) {
    expect(e).toBeInstanceOf(PageUnparseableError);
    return (e as PageUnparseableError).reason;
  }
  return "parsed";
}

describe("pre-scan bypasses", () => {
  it("stray closers do not pop", () => {
    expect(maxOpenDepth(r("<div></x>", 5))).toBe(5);
    expect(maxOpenDepth(r("<div></span>", 5))).toBe(5);
    expect(maxOpenDepth("<div><span></div></span>")).toBe(2);
    expect(maxOpenDepth("<div><p><b></div><i>")).toBe(2);
  });
  it("comments end at --!>, <!--> and <!--->", () => {
    expect(maxOpenDepth(`<!-- --!>${r("<div>", 4)}`)).toBe(4);
    expect(maxOpenDepth(`<!-->${r("<div>", 4)}`)).toBe(4);
    expect(maxOpenDepth(`<!--->${r("<div>", 4)}`)).toBe(4);
  });
  it("a name starting with '=' does not open a quoted value", () => {
    expect(maxOpenDepth(`<div =">${r("<div>", 4)}`)).toBe(5);
    expect(maxOpenDepth(`<a href="x>y"><b></b></a>`)).toBe(2);
  });
  it("title/style content inside svg is markup, not text", () => {
    expect(maxOpenDepth(`<svg><title>${r("<div>", 4)}`)).toBe(6);
    expect(maxOpenDepth(`<div><title>${r("<div>", 4)}</title></div>`)).toBe(1);
  });
  it("unterminated constructs stop the scan instead of skipping to the end", () => {
    expect(maxOpenDepth(`<div><!-- ${r("<div>", 9)}`)).toBe(1);
    expect(maxOpenDepth(`<div><a href="${r("<div>", 9)}`)).toBe(1);
  });
  it("stays linear: 5 MB scans fast", () => {
    const calm = r("<p>word</p>", 5_000_000 / 11);
    const hostile = r("<div></x>", 5_000_000 / 9);
    for (const html of [calm, hostile]) {
      const t = performance.now();
      maxOpenDepth(html);
      expect(performance.now() - t).toBeLessThan(400);
    }
  });
});

describe("parsePageSafe", () => {
  it.each([
    ["stray </x> closers", r("<div></x>", 20_000)],
    ["stray </span> closers", r("<div></span>", 20_000)],
    ["--!> comment", `<!-- --!>${r("<div>", 20_000)}`],
    ["<!--> comment", `<!-->${r("<div>", 20_000)}`],
    ["<!---> comment", `<!--->${r("<div>", 20_000)}`],
    ['<div =">', `<div =">${r("<div>", 20_000)}`],
    ["svg title + divs", `<svg><title>${r("<div>", 3000)}`],
    ["plain 100k divs", r("<div>", 100_000)],
  ])("refuses %s quickly as too-deep", async (_n, html) => {
    const t = performance.now();
    expect(await reason(html)).toBe("too-deep");
    expect(performance.now() - t).toBeLessThan(1500);
  });

  it("formatting-element blowup (below the depth cap) ends as timeout or memory, not a crash", async () => {
    const html = `<div>${distinctB(1400)}${r("</div><div>x", 3000)}`;
    expect(maxOpenDepth(html)).toBeLessThan(MAX_NESTING);
    const t = performance.now();
    expect(["timeout", "memory"]).toContain(await reason(html, 1500));
    expect(performance.now() - t).toBeLessThan(6000);
    // the process is alive and the next page parses on a fresh worker
    const page = await parsePageSafe(
      "<html><body><h1>ok</h1></body></html>",
      "/",
    );
    expect(page.headings[0]?.text).toBe("ok");
  });

  it("reuses one worker and respawns after a timeout", async () => {
    await parsePageSafe("<p>a</p>", "/a");
    const before = workerSpawnCount();
    for (let i = 0; i < 20; i++) await parsePageSafe(`<p>${i}</p>`, `/p${i}`);
    expect(workerSpawnCount()).toBe(before);

    const slow = `<div>${distinctB(1400)}${r("</div><div>x", 3000)}`;
    await reason(slow, 300);
    const p = await parsePageSafe("<h1>after</h1>", "/after");
    expect(p.key).toBe("/after");
    expect(workerSpawnCount()).toBe(before + 1);
  });

  it("a caught error keeps the worker (no respawn)", async () => {
    await parsePageSafe("<p>a</p>", "/a");
    const before = workerSpawnCount();
    expect(await reason(r("<div>", 2000))).toBe("too-deep");
    await parsePageSafe("<p>b</p>", "/b");
    expect(workerSpawnCount()).toBe(before);
  });

  it("handles a realistic 2 MB page within the limits", async () => {
    const html = `<html><head><title>t</title></head><body><main>${r("<p>sana <a href='/x'>y</a></p>", 70_000)}</main></body></html>`;
    const p = await parsePageSafe(html, "/", undefined, { timeoutMs: 20_000 });
    expect(p.links.length).toBe(70_000);
  }, 30_000);

  it("concurrent calls are serialized and all resolve", async () => {
    const out = await Promise.all(
      [1, 2, 3, 4, 5].map((i) =>
        parsePageSafe(`<h1>${i}</h1>`, `/${i}`, undefined, fast),
      ),
    );
    expect(out.map((p) => p.key)).toEqual(["/1", "/2", "/3", "/4", "/5"]);
  });

  it("toUnparseable classifies errors", () => {
    expect(toUnparseable(new PageTooDeepError(2000)).reason).toBe("too-deep");
    expect(
      toUnparseable(new RangeError("Maximum call stack size exceeded")).reason,
    ).toBe("stack");
    expect(toUnparseable(new Error("x")).reason).toBe("error");
    expect(toUnparseable(new RangeError("Invalid string length")).reason).toBe(
      "error",
    );
  });
});

describe("parsePageSafe parity with parsePage", () => {
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".html") && !p.includes("broken-deep")) files.push(p);
    }
  };
  walk("tests/fixtures/sites");

  it("returns identical pages for every fixture site page", async () => {
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const html = readFileSync(f, "utf8");
      const safe = await parsePageSafe(html, "/k/", f);
      expect(safe, f).toEqual(parsePage(html, "/k/", f));
    }
  });
});
