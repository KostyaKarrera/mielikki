// A process that uses the parse subprocess and then waits to be killed
// (or, with argv[2] === "exit", exits on its own) - for the orphan test.
import { parsePageSafe } from "../../dist/parse/safe.js";

const p = await parsePageSafe("<h1>ok</h1>", "/");
process.stdout.write(`parsed ${p.headings[0]?.text}\n`);
if (process.argv[2] !== "exit") setInterval(() => undefined, 1000);
