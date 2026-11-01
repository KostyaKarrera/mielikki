import { readFile } from "node:fs/promises";
import Validator from "@adobe/structured-data-validator";

const VOCAB_URL = new URL(
  "../../../vendor/schemaorg-all-https.jsonld",
  import.meta.url,
);

let validator: Promise<Validator> | undefined;

/** One Validator (and one read of the vendored vocabulary) per process. */
export function getValidator(): Promise<Validator> {
  validator ??= readFile(VOCAB_URL, "utf8").then(
    (text) => new Validator(JSON.parse(text)),
  );
  // A failed load must not be cached forever.
  validator.catch(() => {
    validator = undefined;
  });
  return validator;
}
