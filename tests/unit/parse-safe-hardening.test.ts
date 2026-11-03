import { EventEmitter } from "node:events";
import type { Worker } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PageUnparseableError,
  parseHooks,
  parseLimits,
  parsePageSafe,
  resetParseWorker,
  workerSpawnCount,
} from "../../src/parse/safe.js";

class FakeWorker extends EventEmitter {
  unrefs = 0;
  terminated = 0;
  posted: unknown[] = [];
  constructor(
    private behavior: {
      ready: boolean;
      reply?: (w: FakeWorker, m: { key: string }) => void;
      terminate?: () => Promise<number>;
    },
  ) {
    super();
    if (behavior.ready)
      setImmediate(() => this.emit("message", { ready: true }));
  }
  unref(): void {
    this.unrefs++;
  }
  postMessage(m: { key: string }): void {
    this.posted.push(m);
    this.behavior.reply?.(this, m);
  }
  terminate(): Promise<number> {
    this.terminated++;
    return this.behavior.terminate?.() ?? Promise.resolve(0);
  }
}
const okReply = (w: FakeWorker, m: { key: string }): void => {
  setImmediate(() => w.emit("message", { ok: true, page: { key: m.key } }));
};

const saved = { ...parseLimits };
let made: FakeWorker[] = [];
const useWorkers = (
  ...behaviors: ConstructorParameters<typeof FakeWorker>[0][]
) => {
  let i = 0;
  parseHooks.createWorker = () => {
    const w = new FakeWorker(
      behaviors[Math.min(i++, behaviors.length - 1)] as never,
    );
    made.push(w);
    return w as unknown as Worker;
  };
};

beforeEach(() => {
  made = [];
});
afterEach(() => {
  resetParseWorker();
  parseHooks.createWorker = undefined;
  Object.assign(parseLimits, saved);
  delete process.env.MIELIKKI_DEBUG_PARSE;
  vi.restoreAllMocks();
});

describe("parsePageSafe hardening (fake workers)", () => {
  it("a worker that never gets ready is replaced once, then the request fails (no endless wait)", async () => {
    parseLimits.readyMs = 80;
    useWorkers({ ready: false });
    const before = workerSpawnCount();
    const t = performance.now();
    const err = await parsePageSafe("<p>x</p>", "/", undefined, {
      timeoutMs: 100,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PageUnparseableError);
    expect((err as PageUnparseableError).reason).toBe("error");
    expect(workerSpawnCount() - before).toBe(2);
    expect(made.every((w) => w.terminated === 1)).toBe(true);
    expect(performance.now() - t).toBeLessThan(1500);
  });

  it("the second spawn can rescue the request", async () => {
    parseLimits.readyMs = 80;
    useWorkers({ ready: false }, { ready: true, reply: okReply });
    const p = await parsePageSafe("<p>x</p>", "/rescued");
    expect(p.key).toBe("/rescued");
    expect(made).toHaveLength(2);
  });

  it("a worker that ignores terminate() does not block the request or the next one", async () => {
    parseLimits.terminateMs = 50;
    useWorkers(
      { ready: true, terminate: () => new Promise<number>(() => undefined) },
      { ready: true, reply: okReply },
    );
    const t = performance.now();
    const err = await parsePageSafe("<p>x</p>", "/", undefined, {
      timeoutMs: 100,
    }).catch((e: unknown) => e);
    expect((err as PageUnparseableError).reason).toBe("timeout");
    expect(performance.now() - t).toBeLessThan(1000);
    const p = await parsePageSafe("<p>y</p>", "/next");
    expect(p.key).toBe("/next");
    expect(made[0]?.terminated).toBe(1);
    expect(made[0]?.unrefs).toBeGreaterThanOrEqual(2); // at spawn and when abandoned
  });

  it("a result arriving after the request settled is dropped", async () => {
    useWorkers(
      {
        ready: true,
        reply: (w, m) => {
          setTimeout(
            () => w.emit("message", { ok: true, page: { key: m.key } }),
            250,
          );
        },
      },
      { ready: true, reply: okReply },
    );
    const err = await parsePageSafe("<p>x</p>", "/late", undefined, {
      timeoutMs: 60,
    }).catch((e: unknown) => e);
    expect((err as PageUnparseableError).reason).toBe("timeout");
    const p = await parsePageSafe("<p>y</p>", "/fresh");
    expect(p.key).toBe("/fresh");
    await new Promise((r) => setTimeout(r, 300)); // the late reply fires into no listener
  });

  it("every request settles within the page limit plus the start-up bounds", async () => {
    parseLimits.readyMs = 60;
    parseLimits.graceMs = 60;
    useWorkers({ ready: false });
    const t = performance.now();
    await parsePageSafe("<p>x</p>", "/", undefined, { timeoutMs: 60 }).catch(
      () => undefined,
    );
    expect(performance.now() - t).toBeLessThan(60 + 2 * 60 + 60 + 400);
  });
});

describe("MIELIKKI_DEBUG_PARSE", () => {
  it("is silent by default", async () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    useWorkers({ ready: true, reply: okReply });
    await parsePageSafe("<p>x</p>", "/");
    expect(write).not.toHaveBeenCalled();
  });

  it("traces the worker lifecycle without page content", async () => {
    process.env.MIELIKKI_DEBUG_PARSE = "1";
    const lines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((s) => {
      lines.push(String(s));
      return true;
    });
    useWorkers({ ready: true });
    await parsePageSafe("<p>TOPSECRET</p>", "/", undefined, {
      timeoutMs: 50,
    }).catch(() => undefined);
    const text = lines.join("");
    for (const ev of ["spawn", "ready", "timeout", "terminate-requested"])
      expect(text).toContain(` ${ev}`);
    expect(text).toMatch(/\[mielikki-parse\] \d{4}-\d\d-\d\dT/);
    expect(text).not.toContain("TOPSECRET");
  });
});
