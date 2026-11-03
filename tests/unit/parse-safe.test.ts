import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_NESTING, maxOpenDepth } from "../../src/parse/depth.js";
import { parsePage } from "../../src/parse/page.js";
import {
  heapMbFor,
  PageUnparseableError,
  parsePageSafe,
  timeoutFor,
  workerSpawnCount,
} from "../../src/parse/safe.js";

const r = (s: string, k: number): string => s.repeat(k);
const distinctB = (n: number): string =>
  Array.from({ length: n }, (_, i) => `<b a${i}>`).join("");

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

const reconstruction = (reps: number): string =>
  `<div>${distinctB(1400)}${r("</div><div>x", reps)}`;

describe("parsePageSafe", () => {
  it.each([
    ["stray </x> closers", r("<div></x>", 20_000)],
    ["stray </span> closers", r("<div></span>", 20_000)],
    ["--!> comment", `<!-- --!>${r("<div>", 40_000)}`],
    ["<!--> comment", `<!-->${r("<div>", 40_000)}`],
    ["<!---> comment", `<!--->${r("<div>", 40_000)}`],
    ['<div =">', `<div =">${r("<div>", 40_000)}`],
    ["plain 100k divs", r("<div>", 100_000)],
  ])(
    "%s: the worker gives up and the finding is too-deep",
    async (_n, html) => {
      const t = performance.now();
      expect(await reason(html)).toBe("too-deep");
      expect(performance.now() - t).toBeLessThan(2500);
    },
  );

  it.each([
    ["li > a", "<li><a href=/x>x</li>"],
    ["td > span", "<td><span>x</td>"],
    ["td > div", "<td><div>x</td>"],
    ["li > span", "<li><span>x</li>"],
    ["p > b", "<p><b>x</p>"],
    ["p > strong", "<p><strong>x</p>"],
    ["dd > span", "<dd><span>x</dd>"],
    ["option > span", "<option><span>x</option>"],
    ["stray <b", "a<b then "],
  ])(
    "sloppy real markup %s x1600 parses fine, no refusal",
    async (_n, unit) => {
      const html = `<html><body><main>${r(unit, 1600)}</main></body></html>`;
      const p = await parsePageSafe(html, "/");
      expect(p.key).toBe("/");
    },
  );

  it("formatting-element blowup (below the depth cap) ends as timeout or memory, not a crash", async () => {
    const html = reconstruction(3000);
    expect(maxOpenDepth(html)).toBeLessThan(MAX_NESTING);
    const t = performance.now();
    expect(["timeout", "memory"]).toContain(await reason(html, 1500));
    expect(performance.now() - t).toBeLessThan(6000);
    const page = await parsePageSafe(
      "<html><body><h1>ok</h1></body></html>",
      "/",
    );
    expect(page.headings[0]?.text).toBe("ok");
  });

  it("never raises an unhandled error when the limit races an out-of-memory", async () => {
    const uncaught: unknown[] = [];
    const on = (e: unknown): void => void uncaught.push(e);
    process.on("uncaughtException", on);
    try {
      const html = reconstruction(3000);
      for (let i = 0; i < 40; i++) {
        await reason(html, 40 + i * 12);
      }
      await new Promise((res) => setTimeout(res, 300));
      expect(uncaught).toEqual([]);
      const p = await parsePageSafe("<h1>fine</h1>", "/");
      expect(p.headings[0]?.text).toBe("fine");
    } finally {
      process.off("uncaughtException", on);
    }
  }, 120_000);

  it("reuses one worker and respawns after a timeout", async () => {
    await parsePageSafe("<p>a</p>", "/a");
    const before = workerSpawnCount();
    for (let i = 0; i < 20; i++) await parsePageSafe(`<p>${i}</p>`, `/p${i}`);
    expect(workerSpawnCount()).toBe(before);

    await reason(reconstruction(3000), 300);
    const p = await parsePageSafe("<h1>after</h1>", "/after");
    expect(p.key).toBe("/after");
    expect(workerSpawnCount()).toBe(before + 1);
  });

  it("a larger worker serves small pages; a small one is replaced for a large page", async () => {
    await parsePageSafe("<p>a</p>", "/a");
    const s0 = workerSpawnCount();
    const big = `<html><body>${r("<p>sana</p>", 120_000)}</body></html>`; // ~1.3 MB
    expect(heapMbFor(big.length)).toBeGreaterThan(256);
    await parsePageSafe(big, "/big", undefined, { timeoutMs: 20_000 });
    expect(workerSpawnCount()).toBe(s0 + 1);
    await parsePageSafe("<p>small</p>", "/small");
    await parsePageSafe(big, "/big", undefined, { timeoutMs: 20_000 });
    expect(workerSpawnCount()).toBe(s0 + 1);
  }, 60_000);

  it("limits scale with the page size", () => {
    expect(heapMbFor(1000)).toBe(256);
    expect(heapMbFor(2 * 1024 * 1024)).toBe(656);
    expect(heapMbFor(50 * 1024 * 1024)).toBe(1536);
    expect(timeoutFor(1000, false)).toBe(5003);
    expect(timeoutFor(10 * 1024 * 1024, false)).toBe(20_000);
    expect(timeoutFor(1024 * 1024, true)).toBe(33_000);
  });

  it("parses a ~3 MB link list and a ~4.5 MB table", async () => {
    const links = `<html><body><main>${r('<a href="/some/long/path/x">anchor text</a> ', 70_000)}</main></body></html>`;
    const table = `<html><body><table>${r("<tr><td>cell one</td><td>cell two</td></tr>", 110_000)}</table></body></html>`;
    expect(links.length).toBeGreaterThan(2.9e6);
    expect(table.length).toBeGreaterThan(4.4e6);
    for (const [html, key] of [
      [links, "/links"],
      [table, "/table"],
    ] as const) {
      const t = performance.now();
      const p = await parsePageSafe(html, key);
      console.log(
        key,
        html.length,
        "bytes parsed in",
        Math.round(performance.now() - t),
        "ms",
      );
      expect(p.key).toBe(key);
    }
  }, 120_000);

  it("concurrent calls are serialized and all resolve", async () => {
    const out = await Promise.all(
      [1, 2, 3, 4, 5].map((i) => parsePageSafe(`<h1>${i}</h1>`, `/${i}`)),
    );
    expect(out.map((p) => p.key)).toEqual(["/1", "/2", "/3", "/4", "/5"]);
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
