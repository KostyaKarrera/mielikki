import type { Asset, Link } from "../../model/types.js";

/** Internal links that point somewhere: not in-page fragments, empty hrefs or non-page schemes. */
export function navigableInternal(links: readonly Link[]): Link[] {
  return links.filter(
    (l) =>
      l.internal &&
      l.key !== undefined &&
      l.href !== "" &&
      !l.href.startsWith("#") &&
      !/^(mailto|tel):/i.test(l.href),
  );
}

/** True when links/trailing-slash reports this link under the given policy. */
export function reportedByTrailingSlash(
  l: Link,
  policy: string,
  assets: ReadonlyMap<string, Asset>,
): boolean {
  if (policy !== "always" && policy !== "never") return false;
  if (!(l.key as string).endsWith("/") || assets.has(l.key as string))
    return false;
  let pathname: string;
  try {
    pathname = new URL(l.href, "http://mielikki.invalid/").pathname;
  } catch {
    return false;
  }
  if (/\.[^/.]+$/.test(pathname) || pathname === "/") return false;
  return pathname.endsWith("/") !== (policy === "always");
}
