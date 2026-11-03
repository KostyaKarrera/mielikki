// Parse subprocess stand-in: allocates until V8 hits its heap limit (fatal).
process.on("message", () => {
  const keep = [];
  for (;;) keep.push(new Array(1e5).fill({ x: keep.length }));
});
process.on("disconnect", () => process.exit(0));
process.send({ ready: true });
