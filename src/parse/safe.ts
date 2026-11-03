import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { Page, UnparseableReason } from "../model/types.js";
import { MAX_NESTING, maxOpenDepth } from "./depth.js";
import { PageTooDeepError } from "./page.js";
import type { WorkerReply } from "./worker.js";

export type { UnparseableReason };

/** The page was refused or could not be parsed within safe limits. */
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

/** Any parse failure as a PageUnparseableError (for the in-process parsePage). */
export function toUnparseable(e: unknown): PageUnparseableError {
  if (e instanceof PageUnparseableError) return e;
  if (e instanceof PageTooDeepError)
    return new PageUnparseableError("too-deep", e.depth);
  if (e instanceof RangeError && /call stack/i.test(e.message))
    return new PageUnparseableError("stack");
  return new PageUnparseableError("error");
}

export interface SafeParseOptions {
  /** Wall-clock limit per page, default 5000 ms. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

function workerFile(): string {
  const here = fileURLToPath(import.meta.url);
  // Under vitest this module is TypeScript source; the worker always runs the built JS.
  return here.endsWith(".ts")
    ? path.resolve(path.dirname(here), "../../dist/parse/worker.js")
    : path.join(path.dirname(here), "worker.js");
}

let worker: Worker | undefined;
let ready: Promise<void> = Promise.resolve();
let spawns = 0;
let tail: Promise<unknown> = Promise.resolve();

/** Number of workers started in this process (tests assert reuse). */
export function workerSpawnCount(): number {
  return spawns;
}

function spawn(): Worker {
  spawns++;
  const w = new Worker(workerFile(), {
    resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 4 },
  });
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
  timeoutMs: number,
): Promise<Page> {
  const depth = maxOpenDepth(html);
  if (depth > MAX_NESTING) throw new PageUnparseableError("too-deep", depth);
  worker ??= spawn();
  const w = worker;
  try {
    await ready;
  } catch (e) {
    drop(w);
    throw e;
  }
  return new Promise<Page>((resolve, reject) => {
    const finish = (fn: () => void): void => {
      clearTimeout(timer);
      w.off("message", onMessage);
      w.off("error", onError);
      w.off("exit", onExit);
      fn();
    };
    const fail = (reason: UnparseableReason, d?: number): void => {
      drop(w);
      finish(() => reject(new PageUnparseableError(reason, d)));
    };
    const onMessage = (m: WorkerReply): void => {
      if (m.ok) finish(() => resolve(m.page));
      else if (m.reason === "too-deep" || m.reason === "stack")
        // the worker is healthy after a caught error and is reused
        finish(() => reject(new PageUnparseableError(m.reason, m.depth)));
      else finish(() => reject(new PageUnparseableError("error")));
    };
    const onError = (e: Error & { code?: string }): void =>
      fail(e.code === "ERR_WORKER_OUT_OF_MEMORY" ? "memory" : "error");
    const onExit = (): void => fail("error");
    const timer = setTimeout(() => fail("timeout"), timeoutMs);
    w.on("message", onMessage);
    w.on("error", onError);
    w.on("exit", onExit);
    w.postMessage({ html, key, file });
  });
}

/**
 * parsePage for UNTRUSTED pages: runs in a reused worker thread with a wall-clock
 * timeout and memory limits, so a hostile page cannot hang or crash the process.
 * Rejects with PageUnparseableError. Calls are serialized.
 */
export function parsePageSafe(
  html: string,
  key: string,
  file?: string,
  opts: SafeParseOptions = {},
): Promise<Page> {
  const run = tail.then(() =>
    runOne(html, key, file, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  );
  tail = run.catch(() => undefined);
  return run;
}
