import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PageUnparseableError,
  type ParseChild,
  parseHooks,
  parseLimits,
  parsePageSafe,
  parseSpawnCount,
  resetParseChild,
} from "../../src/parse/safe.js";

interface Behavior {
  ready: boolean;
  reply?: (c: FakeChild, m: { key: string }) => void;
  /** The child ignores kill() (never exits). */
  unkillable?: boolean;
}

class FakeChild extends EventEmitter {
  unrefs = 0;
  kills: string[] = [];
  disconnects = 0;
  connected = true;
  channelUnrefs = 0;
  channel = { unref: () => void this.channelUnrefs++ };
  posted: unknown[] = [];
  pid = 4242;
  constructor(private behavior: Behavior) {
    super();
    if (behavior.ready)
      setImmediate(() => this.emit("message", { ready: true }));
  }
  unref(): void {
    this.unrefs++;
  }
  disconnect(): void {
    this.disconnects++;
    this.connected = false;
  }
  send(m: { key: string }, cb?: (e: Error | null) => void): boolean {
    this.posted.push(m);
    cb?.(null);
    this.behavior.reply?.(this, m);
    return true;
  }
  kill(signal: string): boolean {
    this.kills.push(signal);
    if (!this.behavior.unkillable)
      setImmediate(() => this.emit("exit", null, signal));
    return true;
  }
  /** Simulates the process dying on its own. */
  die(code: number | null, signal: string | null): void {
    this.connected = false;
    this.emit("exit", code, signal);
  }
}
const page = (key: string): string =>
  JSON.stringify({ key, headings: [], links: [] });
const okReply = (c: FakeChild, m: { key: string }): void => {
  setImmediate(() => c.emit("message", { ok: true, page: page(m.key) }));
};

const saved = { ...parseLimits };
let made: FakeChild[] = [];
const useChildren = (...behaviors: Behavior[]) => {
  let i = 0;
  parseHooks.spawnChild = () => {
    const c = new FakeChild(
      behaviors[Math.min(i++, behaviors.length - 1)] as Behavior,
    );
    made.push(c);
    return c as unknown as ParseChild;
  };
};
const reasonOf = (e: unknown): string => {
  expect(e).toBeInstanceOf(PageUnparseableError);
  return (e as PageUnparseableError).reason;
};

beforeEach(() => {
  made = [];
});
afterEach(() => {
  resetParseChild();
  parseHooks.spawnChild = undefined;
  Object.assign(parseLimits, saved);
  delete process.env.MIELIKKI_DEBUG_PARSE;
  vi.restoreAllMocks();
});

describe("parsePageSafe hardening (fake subprocess)", () => {
  it("a child that never gets ready is replaced once, then the request fails (no endless wait)", async () => {
    parseLimits.readyMs = 80;
    useChildren({ ready: false });
    const before = parseSpawnCount();
    const t = performance.now();
    const err = await parsePageSafe("<p>x</p>", "/", undefined, {
      timeoutMs: 100,
    }).catch((e: unknown) => e);
    expect(reasonOf(err)).toBe("error");
    expect(parseSpawnCount() - before).toBe(2);
    expect(made.every((c) => c.kills.join() === "SIGKILL")).toBe(true);
    expect(made.every((c) => c.disconnects === 1)).toBe(true);
    expect(performance.now() - t).toBeLessThan(1500);
  });

  it("the second spawn can rescue the request", async () => {
    parseLimits.readyMs = 80;
    useChildren({ ready: false }, { ready: true, reply: okReply });
    const p = await parsePageSafe("<p>x</p>", "/rescued");
    expect(p.key).toBe("/rescued");
    expect(p.html).toBe("<p>x</p>"); // the parent restores html, it is not sent back
    expect(made).toHaveLength(2);
  });

  it("an idle child never keeps the process alive", async () => {
    useChildren({ ready: true, reply: okReply });
    await parsePageSafe("<p>x</p>", "/");
    expect(made[0]?.unrefs).toBeGreaterThanOrEqual(1);
    expect(made[0]?.channelUnrefs).toBe(1);
  });

  it("a child that ignores kill does not block the request or the next one", async () => {
    parseLimits.terminateMs = 50;
    useChildren(
      { ready: true, unkillable: true },
      { ready: true, reply: okReply },
    );
    const t = performance.now();
    const err = await parsePageSafe("<p>x</p>", "/", undefined, {
      timeoutMs: 100,
    }).catch((e: unknown) => e);
    expect(reasonOf(err)).toBe("timeout");
    expect(performance.now() - t).toBeLessThan(1000);
    const p = await parsePageSafe("<p>y</p>", "/next");
    expect(p.key).toBe("/next");
    expect(made[0]?.kills).toEqual(["SIGKILL"]);
    expect(made[0]?.unrefs).toBeGreaterThanOrEqual(2); // at spawn and when abandoned
  });

  it("a result arriving after the request settled is dropped", async () => {
    useChildren(
      {
        ready: true,
        unkillable: true,
        reply: (c, m) => {
          setTimeout(
            () => c.emit("message", { ok: true, page: page(m.key) }),
            250,
          );
        },
      },
      { ready: true, reply: okReply },
    );
    const err = await parsePageSafe("<p>x</p>", "/late", undefined, {
      timeoutMs: 60,
    }).catch((e: unknown) => e);
    expect(reasonOf(err)).toBe("timeout");
    const p = await parsePageSafe("<p>y</p>", "/fresh");
    expect(p.key).toBe("/fresh");
    await new Promise((r) => setTimeout(r, 300)); // the late reply fires into no listener
  });

  it("every request settles within the page limit plus the start-up bounds", async () => {
    parseLimits.readyMs = 60;
    parseLimits.graceMs = 60;
    useChildren({ ready: false });
    const t = performance.now();
    await parsePageSafe("<p>x</p>", "/", undefined, { timeoutMs: 60 }).catch(
      () => undefined,
    );
    expect(performance.now() - t).toBeLessThan(60 + 2 * 60 + 60 + 400);
  });

  it.each([
    ["SIGABRT (fatal V8 out-of-memory)", null, "SIGABRT", "memory"],
    ["exit code 134 (abort on Windows)", 134, null, "memory"],
    ["SIGKILL from the system OOM killer", null, "SIGKILL", "memory"],
    ["exit code 1", 1, null, "error"],
    ["SIGSEGV", null, "SIGSEGV", "error"],
  ] as const)(
    "a child dying mid-request with %s is %s",
    async (_n, code, signal, want) => {
      useChildren(
        { ready: true, reply: (c) => setImmediate(() => c.die(code, signal)) },
        { ready: true, reply: okReply },
      );
      const err = await parsePageSafe("<p>x</p>", "/").catch((e: unknown) => e);
      expect(reasonOf(err)).toBe(want);
      const p = await parsePageSafe("<p>y</p>", "/next");
      expect(p.key).toBe("/next");
      expect(made).toHaveLength(2);
    },
  );

  it("a child that died while idle is replaced before the next page", async () => {
    useChildren({ ready: true, reply: okReply });
    await parsePageSafe("<p>x</p>", "/a");
    made[0]?.die(null, "SIGTERM");
    const p = await parsePageSafe("<p>y</p>", "/b");
    expect(p.key).toBe("/b");
    expect(made).toHaveLength(2);
  });

  it("a stack overflow reply keeps the child; a memory reply replaces it", async () => {
    let n = 0;
    useChildren({
      ready: true,
      reply: (c, m) =>
        setImmediate(() =>
          c.emit(
            "message",
            n++ === 0
              ? { ok: false, reason: "stack" }
              : n === 2
                ? { ok: false, reason: "memory" }
                : { ok: true, page: page(m.key) },
          ),
        ),
    });
    expect(reasonOf(await parsePageSafe("<p>a</p>", "/").catch((e) => e))).toBe(
      "stack",
    );
    expect(made).toHaveLength(1);
    expect(reasonOf(await parsePageSafe("<p>b</p>", "/").catch((e) => e))).toBe(
      "memory",
    );
    expect((await parsePageSafe("<p>c</p>", "/c")).key).toBe("/c");
    expect(made).toHaveLength(2);
  });

  it("a parser bug is a plain Error, not a finding", async () => {
    useChildren({
      ready: true,
      reply: (c) =>
        setImmediate(() =>
          c.emit("message", { ok: false, reason: "bug", message: "boom" }),
        ),
    });
    const err = await parsePageSafe("<p>a</p>", "/").catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(PageUnparseableError);
    expect((err as Error).message).toBe("page parser failed: boom");
  });
});

describe("MIELIKKI_DEBUG_PARSE", () => {
  it("is silent by default", async () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    useChildren({ ready: true, reply: okReply });
    await parsePageSafe("<p>x</p>", "/");
    expect(write).not.toHaveBeenCalled();
  });

  it("traces the subprocess lifecycle without page content", async () => {
    process.env.MIELIKKI_DEBUG_PARSE = "1";
    const lines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((s) => {
      lines.push(String(s));
      return true;
    });
    useChildren({ ready: true });
    await parsePageSafe("<p>TOPSECRET</p>", "/", undefined, {
      timeoutMs: 50,
    }).catch(() => undefined);
    await new Promise((r) => setImmediate(r));
    const text = lines.join("");
    for (const ev of [
      "spawn pid=4242",
      "ready",
      "timeout",
      "terminate-requested",
      "exited",
    ])
      expect(text).toContain(` ${ev}`);
    expect(text).toMatch(/\[mielikki-parse\] \d{4}-\d\d-\d\dT/);
    expect(text).not.toContain("TOPSECRET");
  });
});
