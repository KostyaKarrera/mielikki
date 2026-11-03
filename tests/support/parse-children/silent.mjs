// Parse subprocess stand-in: starts but never signals ready.
setInterval(() => undefined, 1000);
process.on("message", () => undefined);
