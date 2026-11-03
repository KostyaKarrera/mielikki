// tsc does not set the executable bit; the published bin needs it (no-op on Windows).
import { chmodSync } from "node:fs";

chmodSync("dist/cli.js", 0o755);
