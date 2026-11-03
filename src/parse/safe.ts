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

let worker: Worker | undefined;
let workerHeapMb = 0;
let ready: Promise<void> = Promise.resolve();
let spawns = 0;
let tail: Promise<unknown> = Promise.resolve();

/** Number of workers started in this process (tests assert reuse). */
export function workerSpawnCount(): number {
  return spawns;
}

function spawn(heapMb: number): Worker {
  const file = workerFile();
  if (!existsSync(file))
    throw new Error(
      `mielikki installation is broken: parse worker not found at ${file}`,
    );
  spawns++;
  const w = new Worker(file, {
    resourceLimits: { maxOldGenerationSizeMb: heapMb, stackSizeMb: 4 },
  });
  // A worker must never be able to raise an unhandled error in the main
  // thread, e.g. an out-of-memory racing with terminate().
  w.on("error", () => undefined);
  w.on("messageerror", () => undefined);
  w.unref(); // an idle worker never keeps the CLI alive
  // The time limit starts when the worker is up, not while it is starting.
  ready = new Promise<void>((resolve, reject) => {
    const off = (): void => {
      w.off("message", onReady);
      w.off("error", onFail);
      w.off("exit", onFail);
    };
    const onReady = (): void => {
      off();
      resolve();
    };
    const onFail = (): void => {
      off();
      reject(new PageUnparseableError("error"));
    };
    w.once("message", onReady);
    w.once("error", onFail);
    w.once("exit", onFail);
  });
  ready.catch(() => undefined);
  workerHeapMb = heapMb;
  return w;
}

function drop(w: Worker): void {
  if (worker === w) worker = undefined;
  void w.terminate();
}

async function runOne(
  html: string,
  key: string,
  file: string | undefined,
  opts: SafeParseOptions,
): Promise<Page> {
  // Only a hint: a deep-looking page still goes to the worker, which decides.
  const hint = maxOpenDepth(html);
  const timeoutMs =
    opts.timeoutMs ?? timeoutFor(html.length, opts.own === true);
  const need = heapMbFor(html.length);
  // a bigger worker also serves small pages; a too small one is replaced
  if (worker !== undefined && workerHeapMb < need) drop(worker);
  worker ??= spawn(need);
  const w = worker;
  try {
    await ready;
  } catch (e) {
    drop(w);
    throw e;
  }
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
        drop(w);
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
    const timer = setTimeout(() => fail("timeout"), timeoutMs);
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
 * serialized.
 */
export function parsePageSafe(
  html: string,
  key: string,
  file?: string,
  opts: SafeParseOptions = {},
): Promise<Page> {
  const run = tail.then(() => runOne(html, key, file, opts));
  tail = run.catch(() => undefined);
  return run;
}
