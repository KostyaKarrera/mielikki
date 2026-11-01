// Downloads the schema.org vocabulary into vendor/. Run manually: node scripts/update-schemaorg.mjs
import { mkdir, writeFile } from "node:fs/promises";

const URL_ = "https://schema.org/version/latest/schemaorg-all-https.jsonld";
const out = new URL("../vendor/schemaorg-all-https.jsonld", import.meta.url);

const res = await fetch(URL_);
if (!res.ok)
  throw new Error(`Download failed: ${res.status} ${res.statusText}`);
const text = await res.text();
JSON.parse(text); // fail early on a broken download
await mkdir(new URL("./", out), { recursive: true });
await writeFile(out, text);
console.log(`Wrote ${out.pathname} (${text.length} bytes)`);
