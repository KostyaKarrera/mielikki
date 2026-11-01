import type { Page } from "../../model/types.js";

/** Trimmed, non-empty value of an Open Graph / Twitter tag. */
export function tag(
  map: Page["og"] | Page["twitter"],
  name: string,
): string | undefined {
  const v = map[name]?.trim();
  return v === undefined || v === "" ? undefined : v;
}
