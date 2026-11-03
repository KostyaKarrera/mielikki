import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { Page, UnparseableReason } from "../model/types.js";
import { MAX_NESTING, maxOpenDepth } from "./depth.js";
import type { WorkerReply } from "./worker.js";

export type { UnparseableReason };

/** The page could not be parsed within bounded time and memory. */
export class PageUnparseableError extends Error {
  constructor(
    readonly reason: UnparseableReason,
    readonly depth?: number,
  ) {
    super(
      reason === "too-deep"
        ? `page too deeply nested (${depth} > ${MAX_NESTING})`
        : `page could not be parsed safely (${reason})`,
    );
    this.name = "PageUnparseableError";
  }
}

export interface SafeParseOptions {
  /** Exact wall-clock limit in ms; overrides the size-based default (tests). */
  timeoutMs?: number;
  /**
   * The user's own build (check <dir>): generous limits, so a slow machine
   * never makes the result flaky. Default: untrusted page.
   */
  own?: boolean;
}

const MB = 1024 * 1024;
const SMALL_HEAP_MB = 256;
const LARGE_HEAP_MB = 1536;

/** Heap for a page: 256 MB up to 1 MB of HTML, then 256 + 200 MB per MB, at most 1536. */
export function heapMbFor(htmlLength: number): number {
  if (htmlLength <= MB) return SMALL_HEAP_MB;
  return Math.min(
    LARGE_HEAP_MB,
    Math.round(SMALL_HEAP_MB + (200 * htmlLength) / MB),
  );
}

/** Wall-clock limit for a page. */
export function timeoutFor(htmlLength: number, own: boolean): number {
  const mb = htmlLength / MB;
  return own
    ? Math.round(30_000 + 3000 * mb)
    : Math.min(20_000, Math.round(5000 + 3000 * mb));
}

function workerFile(): string {
  const here = fileURLToPath(import.meta.url);
  // Under vitest this module is TypeScript source; the worker always runs the built JS.
  return here.endsWith(".ts")
    ? path.resolve(path.dirname(here), "../../dist/parse/worker.js")
    : path.join(path.dirname(here), "worker.js");
}

/** Bounds that make every request settle, whatever the worker does. */
export const parseLimits = {
  /** A new worker must signal ready within this time (else respawn once). */
  readyMs: 10_000,
  /** Longest we wait for terminate() before abandoning a worker. */
  terminateMs: 3000,
  /** Extra time beyond the page wall clock before the outer guard settles. */
  graceMs: 5000,
};

/** Test seam: replaces the Worker constructor. */
export const parseHooks: {
  createWorker?: (file: string, heapMb: number) => Worker;
} = {};

let nextId = 1;
/** Opt-in lifecycle trace (MIELIKKI_DEBUG_PARSE=1): no page content, no secrets. */
function debug(id: number, event: string): void {
  if (process.env.MIELIKKI_DEBUG_PARSE !== "1") return;
  process.stderr.write(
    `[mielikki-parse] ${new Date().toISOString()} worker#${id} ${event}\n`,
  );
}

interface Spawned {
  w: Worker;
  id: number;
  heapMb: number;
  ready: Promise<void>;
}

let current: Spawned | undefined;
let spawns = 0;
let tail: Promise<unknown> = Promise.resolve();

/** Number of workers started in this process (tests assert reuse). */
export function workerSpawnCount(): number {
  return spawns;
}

function spawn(heapMb: number): Spawned {
  const file = workerFile();
  if (!existsSync(file))
    throw new Error(
      `mielikki installation is broken: parse worker not found at ${file}`,
    );
  spawns++;
  const id = nextId++;
  const w =
    parseHooks.createWorker?.(file, heapMb) ??
    new Worker(file, {
      resourceLimits: { maxOldGenerationSizeMb: heapMb, stackSizeMb: 4 },
    });
  debug(id, `spawn heap=${heapMb}MB`);
  // A worker must never be able to raise an unhandled error in the main
  // thread, e.g. an out-of-memory racing with terminate().
  w.on("error", (e: Error & { code?: string }) =>
    debug(id, e.code === "ERR_WORKER_OUT_OF_MEMORY" ? "oom" : "error"),
  );
  w.on("messageerror", () => debug(id, "messageerror"));
  w.on("exit", (code: number) => debug(id, `exited code=${code}`));
  w.unref(); // an idle worker never keeps the CLI alive
  // The time limit starts when the worker is up, not while it is starting.
  const ready = new Promise<void>((resolve, reject) => {
    const off = (): void => {
      clearTimeout(timer);
      w.off("message", onReady);
      w.off("error", onFail);
      w.off("exit", onFail);
    };
    const onReady = (): void => {
      off();
      debug(id, "ready");
      resolve();
    };
    const onFail = (): void => {
      off();
      reject(new PageUnparseableError("error"));
    };
    const timer = setTimeout(() => {
      debug(id, "ready-timeout");
      onFail();
    }, parseLimits.readyMs);
    timer.unref();
    w.once("message", onReady);
    w.once("error", onFail);
    w.once("exit", onFail);
  });
  ready.catch(() => undefined);
  return { w, id, heapMb, ready };
}

/** Terminates a worker without ever waiting for it: it is abandoned if it will not die. */
function drop(s: Spawned): void {
  if (current === s) current = undefined;
  debug(s.id, "terminate-requested");
  s.w.unref();
  const timer = setTimeout(
    () => debug(s.id, "terminate-abandoned"),
    parseLimits.terminateMs,
  );
  timer.unref();
  void Promise.resolve(s.w.terminate())
    .catch(() => undefined)
    .finally(() => clearTimeout(timer));
}

/** A ready worker of at least `need` MB; a worker that never gets ready is replaced once. */
async function acquire(need: number): Promise<Spawned> {
  for (let attempt = 0; ; attempt++) {
    if (current !== undefined && current.heapMb < need) drop(current);
    current ??= spawn(need);
    const s = current;
    try {
      await s.ready;
      return s;
    } catch {
      drop(s);
      if (attempt >= 1) throw new PageUnparseableError("error");
    }
  }
}

async function runOne(
  html: string,
  key: string,
  file: string | undefined,
  timeoutMs: number,
  ctx: { cancelled: boolean },
): Promise<Page> {
  // Only a hint: a deep-looking page still goes to the worker, which decides.
  const hint = maxOpenDepth(html);
  const s = await acquire(heapMbFor(html.length));
  if (ctx.cancelled) throw new PageUnparseableError("timeout");
  const { w } = s;
  const refuse = (reason: UnparseableReason): PageUnparseableError =>
    hint > MAX_NESTING
      ? new PageUnparseableError("too-deep", hint)
      : new PageUnparseableError(reason);
  return new Promise<Page>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return; // late events of a settled request are ignored
      settled = true;
      clearTimeout(timer);
      w.off("message", onMessage);
      w.off("exit", onExit);
      w.off("error", onError);
      fn();
    };
    const fail = (reason: UnparseableReason): void => {
      finish(() => {
        drop(s);
        reject(refuse(reason));
      });
    };
    const onMessage = (m: WorkerReply): void => {
      if (m.ok) finish(() => resolve(m.page));
      else if (m.reason === "stack")
        // the worker is healthy after a caught error and is reused
        finish(() => reject(refuse("stack")));
      else finish(() => reject(new Error(`page parser failed: ${m.message}`)));
    };
    const onError = (e: Error & { code?: string }): void =>
      fail(e.code === "ERR_WORKER_OUT_OF_MEMORY" ? "memory" : "error");
    const onExit = (): void => fail("error");
    const timer = setTimeout(() => {
      debug(s.id, "timeout");
      fail("timeout");
    }, timeoutMs);
    w.on("message", onMessage);
    w.on("exit", onExit);
    w.once("error", onError);
    w.postMessage({ html, key, file });
  });
}

/**
 * parsePage in a reused worker thread with a wall-clock timeout and memory
 * limits scaled to the page size, so a hostile page cannot hang or crash the
 * process. Rejects with PageUnparseableError when the limits are hit
 * (reason "too-deep" when the page also looks deeper than MAX_NESTING);
 * any other exception is a bug and propagates as a plain Error. Calls are
 * serialized, and every call settles within the page wall clock plus the
 * worker start-up bounds and a fixed grace, whatever the worker does.
 */
export function parsePageSafe(
  html: string,
  key: string,
  file?: string,
  opts: SafeParseOptions = {},
): Promise<Page> {
  const timeoutMs =
    opts.timeoutMs ?? timeoutFor(html.length, opts.own === true);
  const run = tail.then(
    () =>
      new Promise<Page>((resolve, reject) => {
        const ctx = { cancelled: false };
        // outer guard, independent of any worker event
        const guard = setTimeout(
          () => {
            ctx.cancelled = true;
            if (current !== undefined) drop(current);
            reject(new PageUnparseableError("timeout"));
          },
          timeoutMs + 2 * parseLimits.readyMs + parseLimits.graceMs,
        );
        runOne(html, key, file, timeoutMs, ctx).then(
          (p) => {
            clearTimeout(guard);
            resolve(p);
          },
          (e) => {
            clearTimeout(guard);
            reject(e);
          },
        );
      }),
  );
  tail = run.catch(() => undefined);
  return run;
}

/** Test seam: forget (and terminate) the current worker. */
export function resetParseWorker(): void {
  if (current !== undefined) drop(current);
}
