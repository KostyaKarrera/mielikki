// Parse subprocess stand-in: aborts like a fatal V8 out-of-memory does.
process.on("message", () => process.abort());
process.on("disconnect", () => process.exit(0));
process.send({ ready: true });
