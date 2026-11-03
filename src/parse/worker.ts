import { parentPort } from "node:worker_threads";
import { PageTooDeepError, parsePage } from "./page.js";

export type WorkerReply =
  | { ok: true; page: ReturnType<typeof parsePage> }
  | { ok: false; reason: "too-deep" | "stack" | "error"; depth?: number };

export type WorkerReady = { ready: true };

parentPort?.on("message", (m: { html: string; key: string; file?: string }) => {
  let reply: WorkerReply;
  try {
    reply = { ok: true, page: parsePage(m.html, m.key, m.file) };
  } catch (e) {
    if (e instanceof PageTooDeepError)
      reply = { ok: false, reason: "too-deep", depth: e.depth };
    else if (e instanceof RangeError && /call stack/i.test(e.message))
      reply = { ok: false, reason: "stack" };
    else reply = { ok: false, reason: "error" };
  }
  parentPort?.postMessage(reply);
});

parentPort?.postMessage({ ready: true } satisfies WorkerReady);
