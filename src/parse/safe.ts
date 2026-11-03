import { type ChildProcess, fork } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page, UnparseableReason } from "../model/types.js";
import type { ChildReply, ChildRequest } from "./child.js";
import { MAX_NESTING, maxOpenDepth } from "./depth.js";

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

function childFile(): string {
  const here = fileURLToPath(import.meta.url);
  // Under vitest this module is TypeScript source; the subprocess always runs the built JS.
  return here.endsWith(".ts")
    ? path.resolve(path.dirname(here), "../../dist/parse/child.js")
    : path.join(path.dirname(here), "child.js");
}

/** Bounds that make every request settle, whatever the subprocess does. */
export const parseLimits = {
  /** A new subprocess must signal ready within this time (else respawn once). */
  readyMs: 10_000,
  /** Longest we wait for a killed subprocess to exit before abandoning it. */
  terminateMs: 3000,
  /** Extra time beyond the page wall clock before the outer guard settles. */
  graceMs: 5000,
};

/** The part of ChildProcess the parser uses (test seam: a fake child). */
export type ParseChild = Pick<
  ChildProcess,
  "on" | "once" | "off" | "send" | "kill" | "unref" | "disconnect"
> & {
  readonly pid?: number;
  readonly connected: boolean;
  readonly channel?: { unref(): void } | null;
};

/** Test seam: replaces fork() of the parse subprocess. */
export const parseHooks: {
  spawnChild?: (file: string, heapMb: number) => ParseChild;
} = {};

/** Only what the subprocess needs: no tokens or other secrets of the parent. */
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of ["NODE_ENV", "MIELIKKI_DEBUG_PARSE", "SystemRoot"])
    if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}

function forkChild(file: string, heapMb: number): ParseChild {
  return fork(file, [], {
    // own heap limit; the parent's flags and loaders are not inherited
    execArgv: [`--max-old-space-size=${heapMb}`],
    serialization: "advanced",
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: childEnv(),
    windowsHide: true,
  });
}

let nextId = 1;
/** Opt-in lifecycle trace (MIELIKKI_DEBUG_PARSE=1): no page content, no secrets. */
function debug(id: number, event: string): void {
  if (process.env.MIELIKKI_DEBUG_PARSE !== "1") return;
  process.stderr.write(
    `[mielikki-parse] ${new Date().toISOString()} child#${id} ${event}\n`,
  );
}

interface Spawned {
  c: ParseChild;
  id: number;
  heapMb: number;
  ready: Promise<void>;
  exited: boolean;
}

let current: Spawned | undefined;
let spawns = 0;
let tail: Promise<unknown> = Promise.resolve();
/** Subprocesses not yet seen to exit; killed when this process exits. */
const live = new Set<Spawned>();
let exitHook = false;

/** Number of subprocesses started in this process (tests assert reuse). */
export function parseSpawnCount(): number {
  return spawns;
}

/** How a subprocess that died during a request failed. */
function exitReason(
  code: number | null,
  signal: NodeJS.Signals | null,
): UnparseableReason {
  // A fatal V8 out-of-memory aborts (SIGABRT; exit code 134 on Windows);
  // SIGKILL that we did not send is the system OOM killer.
  if (signal === "SIGABRT" || signal === "SIGKILL" || code === 134)
    return "memory";
  return "error";
}

function spawn(heapMb: number): Spawned {
  const file = childFile();
  if (!existsSync(file))
    throw new Error(
      `mielikki installation is broken: parse subprocess entry not found at ${file}`,
    );
  spawns++;
  const id = nextId++;
  const c = (parseHooks.spawnChild ?? forkChild)(file, heapMb);
  const s: Spawned = { c, id, heapMb, ready: Promise.resolve(), exited: false };
  live.add(s);
  if (!exitHook) {
    exitHook = true;
    // the subprocess never outlives this process (it also exits on disconnect)
    process.once("exit", () => {
      for (const l of live) l.c.kill("SIGKILL");
    });
  }
  debug(id, `spawn pid=${c.pid ?? "?"} heap=${heapMb}MB`);
  // A subprocess must never be able to raise an unhandled error here,
  // e.g. a send() racing with its death.
  c.on("error", () => debug(id, "error"));
  c.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
    s.exited = true;
    live.delete(s);
    debug(id, `exited code=${code} signal=${signal}`);
  });
  // an idle subprocess never keeps the CLI alive
  c.unref();
  c.channel?.unref();
  // The time limit starts when the subprocess is up, not while it is starting.
  s.ready = new Promise<void>((resolve, reject) => {
    const off = (): void => {
      clearTimeout(timer);
      c.off("message", onReady);
      c.off("error", onFail);
      c.off("exit", onFail);
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
    c.once("message", onReady);
    c.once("error", onFail);
    c.once("exit", onFail);
  });
  s.ready.catch(() => undefined);
  return s;
}

/** Kills a subprocess without ever waiting for it: it is abandoned if it will not die. */
function drop(s: Spawned): void {
  if (current === s) current = undefined;
  if (s.exited) return;
  debug(s.id, "terminate-requested");
  s.c.unref();
  const timer = setTimeout(() => {
    if (!s.exited) debug(s.id, "terminate-abandoned");
  }, parseLimits.terminateMs);
  timer.unref();
  s.c.once("exit", () => clearTimeout(timer));
  try {
    if (s.c.connected) s.c.disconnect();
  } catch {
    // already disconnected
  }
  try {
    s.c.kill("SIGKILL");
  } catch {
    // already gone
  }
}

/** A ready subprocess of at least `need` MB; one that never gets ready is replaced once. */
async function acquire(need: number): Promise<Spawned> {
  for (let attempt = 0; ; attempt++) {
    if (current !== undefined && (current.heapMb < need || current.exited))
      drop(current);
    current ??= spawn(need);
    const s = current;
    try {
      await s.ready;
      if (s.exited) throw new PageUnparseableError("error");
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
  // Only a hint: a deep-looking page still goes to the subprocess, which decides.
  const hint = maxOpenDepth(html);
  const s = await acquire(heapMbFor(html.length));
  if (ctx.cancelled) throw new PageUnparseableError("timeout");
  const { c } = s;
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
      c.off("message", onMessage);
      c.off("exit", onExit);
      c.off("error", onError);
      fn();
    };
    const fail = (reason: UnparseableReason): void => {
      finish(() => {
        drop(s);
        reject(refuse(reason));
      });
    };
    const onMessage = (m: ChildReply): void => {
      if (m.ok) {
        let page: Page;
        try {
          page = { ...(JSON.parse(m.page) as Omit<Page, "html">), html };
        } catch {
          fail("error");
          return;
        }
        finish(() => resolve(page));
      } else if (m.reason === "stack")
        // the subprocess is healthy after a caught error and is reused
        finish(() => reject(refuse("stack")));
      else if (m.reason === "memory") fail("memory");
      else finish(() => reject(new Error(`page parser failed: ${m.message}`)));
    };
    const onError = (): void => fail("error");
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void =>
      fail(exitReason(code, signal));
    const timer = setTimeout(() => {
      debug(s.id, "timeout");
      fail("timeout");
    }, timeoutMs);
    c.on("message", onMessage);
    c.on("exit", onExit);
    c.on("error", onError);
    if (s.exited) {
      fail("error");
      return;
    }
    try {
      c.send({ html, key, file } satisfies ChildRequest, (err) => {
        if (err) fail("error");
      });
    } catch {
      fail("error");
    }
  });
}

/**
 * parsePage in a reused, isolated subprocess with a wall-clock timeout and
 * a heap limit scaled to the page size, so a hostile page cannot hang or
 * crash this process (a fatal V8 out-of-memory only kills the subprocess). Rejects with PageUnparseableError when the limits are hit
 * (reason "too-deep" when the page also looks deeper than MAX_NESTING);
 * any other exception is a bug and propagates as a plain Error. Calls are
 * serialized, and every call settles within the page wall clock plus the
 * subprocess start-up bounds and a fixed grace, whatever the subprocess does.
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
        // outer guard, independent of any subprocess event
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

/** Test seam: forget (and kill) the current subprocess. */
export function resetParseChild(): void {
  if (current !== undefined) drop(current);
}
