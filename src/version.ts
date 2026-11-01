import { readFileSync } from "node:fs";

const pkgUrl = new URL("../package.json", import.meta.url);
const pkg = JSON.parse(readFileSync(pkgUrl, "utf8")) as { version: string };

export const VERSION: string = pkg.version;
