import type { Link } from "../../model/types.js";

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
