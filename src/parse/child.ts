// Entry point of the isolated parse subprocess (forked by safe.ts). A fatal
// V8 out-of-memory or any other crash here can only end this process.
import { parsePage } from "./page.js";

export interface ChildRequest {
  html: string;
  key: string;
  file?: string;
}

export type ChildReply =
  /** `page` is the parsed Page as JSON, without `html` (the parent has it). */
  | { ok: true; page: string }
  | { ok: false; reason: "stack" }
  | { ok: false; reason: "memory" }
  /** Unexpected exception in the parser: a bug, propagated to the caller. */
  | { ok: false; reason: "bug"; message: string };
export type ChildReady = { ready: true };

function reply(m: ChildRequest): ChildReply {
  try {
    const { html: _html, ...page } = parsePage(m.html, m.key, m.file);
    // One JSON string is cheaper over IPC than the object graph (measured).
    return { ok: true, page: JSON.stringify(page) };
  } catch (e) {
    if (e instanceof RangeError && /call stack/i.test(e.message))
      return { ok: false, reason: "stack" };
    if (
      e instanceof RangeError &&
      /invalid (string|array) length/i.test(e.message)
    )
      return { ok: false, reason: "memory" };
    return {
      ok: false,
      reason: "bug",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

const send = process.send?.bind(process);
if (send === undefined) {
  process.stderr.write("mielikki: the parse subprocess must be forked\n");
  process.exit(2);
} else {
  process.on("message", (m: ChildRequest) => {
    send(reply(m), undefined, undefined, (err: Error | null) => {
      if (err) process.exit(1);
    });
  });
  // the parent is gone (exit, crash, CTRL-C): never outlive it
  process.on("disconnect", () => process.exit(0));
  send({ ready: true } satisfies ChildReady);
}
