import { parentPort } from "node:worker_threads";
import { parsePage } from "./page.js";

export type WorkerReply =
  | { ok: true; page: ReturnType<typeof parsePage> }
  | { ok: false; reason: "stack" }
  /** Unexpected exception in the parser: a bug, propagated to the caller. */
  | { ok: false; reason: "bug"; message: string };
export type WorkerReady = { ready: true };

parentPort?.on("message", (m: { html: string; key: string; file?: string }) => {
  let reply: WorkerReply;
  try {
    reply = { ok: true, page: parsePage(m.html, m.key, m.file) };
  } catch (e) {
    if (e instanceof RangeError && /call stack/i.test(e.message))
      reply = { ok: false, reason: "stack" };
    else
      reply = {
        ok: false,
        reason: "bug",
        message: e instanceof Error ? e.message : String(e),
      };
  }
  parentPort?.postMessage(reply);
});

parentPort?.postMessage({ ready: true } satisfies WorkerReady);
