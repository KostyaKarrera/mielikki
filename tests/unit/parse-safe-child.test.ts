// Real subprocesses: the failure modes a worker thread could not contain
// (Node 24 aborts the whole process on a worker's fatal V8 out-of-memory).
import { fork, spawn } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PageUnparseableError,
  type ParseChild,
  parseHooks,
  parseLimits,
  parsePageSafe,
  resetParseChild,
} from "../../src/parse/safe.js";

const children = path.resolve("tests/support/parse-children");
const saved = { ...parseLimits };

/** The first subprocess runs `script`; later ones are the real parser. */
function firstChild(script: string): void {
  let used = false;
  parseHooks.spawnChild = (file, heapMb) => {
    const real = used;
    used = true;
    return fork(real ? file : path.join(children, script), [], {
      execArgv: [`--max-old-space-size=${heapMb}`],
      serialization: "advanced",
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: {},
    }) as ParseChild;
  };
}

async function reason(html: string, timeoutMs = 10_000): Promise<string> {
  try {
    await parsePageSafe(html, "/", undefined, { timeoutMs });
  } catch (e) {
    expect(e).toBeInstanceOf(PageUnparseableError);
    return (e as PageUnparseableError).reason;
  }
  return "parsed";
}

/** Runs fn and collects unhandled errors raised meanwhile. */
async function noUnhandled(fn: () => Promise<void>): Promise<void> {
  const seen: unknown[] = [];
  const on = (e: unknown): void => void seen.push(e);
  process.on("uncaughtException", on);
  process.on("unhandledRejection", on);
  try {
    await fn();
    await new Promise((r) => setTimeout(r, 200));
  } finally {
    process.off("uncaughtException", on);
    process.off("unhandledRejection", on);
  }
  expect(seen).toEqual([]);
}

afterEach(() => {
  resetParseChild();
  parseHooks.spawnChild = undefined;
  Object.assign(parseLimits, saved);
});

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function gone(pid: number, withinMs: number): Promise<boolean> {
  const end = Date.now() + withinMs;
  while (Date.now() < end) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !alive(pid);
}

describe("parse subprocess failure modes (real processes)", () => {
  it("a fatal V8 out-of-memory in the parser (the 1400 distinct <b> reconstruction page) is memory; this process lives on", async () => {
    await noUnhandled(async () => {
      const b = Array.from({ length: 1400 }, (_, i) => `<b a${i}>`).join("");
      const html = `<div>${b}${"</div><div>x".repeat(3000)}`;
      expect(await reason(html, 20_000)).toBe("memory");
      const p = await parsePageSafe("<h1>next</h1>", "/next");
      expect(p.headings[0]?.text).toBe("next");
    });
  }, 60_000);

  it("a child that allocates until V8's fatal heap-limit abort is memory", async () => {
    firstChild("oom.mjs");
    await noUnhandled(async () => {
      expect(await reason("<p>x</p>")).toBe("memory");
      expect((await parsePageSafe("<h1>ok</h1>", "/")).headings).toHaveLength(
        1,
      );
    });
  }, 30_000);

  it("a child that calls process.abort() is memory", async () => {
    firstChild("abort.mjs");
    await noUnhandled(async () => {
      expect(await reason("<p>x</p>")).toBe("memory");
      expect((await parsePageSafe("<h1>ok</h1>", "/")).key).toBe("/");
    });
  });

  it("a child exiting mid-request is error, and the next page parses", async () => {
    firstChild("exit.mjs");
    await noUnhandled(async () => {
      expect(await reason("<p>x</p>")).toBe("error");
      expect((await parsePageSafe("<h1>ok</h1>", "/")).key).toBe("/");
    });
  });

  it("a child that never signals ready is killed and replaced", async () => {
    parseLimits.readyMs = 1500;
    firstChild("silent.mjs");
    const pids: number[] = [];
    const inner = parseHooks.spawnChild;
    parseHooks.spawnChild = (f, h) => {
      const c = inner?.(f, h) as ParseChild;
      if (c.pid !== undefined) pids.push(c.pid);
      return c;
    };
    const p = await parsePageSafe("<h1>ok</h1>", "/");
    expect(p.key).toBe("/");
    expect(pids).toHaveLength(2);
    expect(await gone(pids[0] as number, 3000)).toBe(true);
  }, 30_000);
});

describe("the parse subprocess never outlives its parent", () => {
  const run = (mode: string) => {
    const parent = spawn(
      process.execPath,
      [path.resolve("tests/support/parse-orphan-parent.mjs"), mode],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, MIELIKKI_DEBUG_PARSE: "1" },
      },
    );
    let out = "";
    let err = "";
    parent.stdout.on("data", (d: Buffer) => {
      out += d;
    });
    parent.stderr.on("data", (d: Buffer) => {
      err += d;
    });
    const parsed = new Promise<number>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`no parse: ${err}`)), 15_000);
      const check = (): void => {
        const pid = /spawn pid=(\d+)/.exec(err)?.[1];
        if (out.includes("parsed ok") && pid) {
          clearTimeout(t);
          resolve(Number(pid));
        }
      };
      parent.stdout.on("data", check);
      parent.stderr.on("data", check);
    });
    const exited = new Promise<number | null>((r) =>
      parent.on("exit", (code) => r(code)),
    );
    return { parent, parsed, exited };
  };

  it.each(["SIGKILL", "SIGINT", "SIGTERM"] as const)(
    "parent killed with %s: the idle child exits",
    async (signal) => {
      const { parent, parsed, exited } = run("wait");
      const pid = await parsed;
      expect(alive(pid)).toBe(true);
      parent.kill(signal);
      await exited;
      expect(await gone(pid, 5000)).toBe(true);
    },
    30_000,
  );

  it("an idle child does not keep the parent alive, and is gone after it exits", async () => {
    const { parsed, exited } = run("exit");
    const pid = await parsed;
    expect(await exited).toBe(0);
    expect(await gone(pid, 5000)).toBe(true);
  }, 30_000);
});
