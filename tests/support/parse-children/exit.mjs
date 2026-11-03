// Parse subprocess stand-in: exits in the middle of a request.
process.on("message", () => process.exit(3));
process.on("disconnect", () => process.exit(0));
process.send({ ready: true });
