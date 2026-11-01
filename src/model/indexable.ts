import { matchPath } from "../rules/glob.js";
import type { Page, Site } from "./types.js";
import { resolveHref } from "./url.js";

export function isRobotsAllowed(
  site: Site,
  key: string,
  agent = "Googlebot",
): boolean {
  return site.robots?.isAllowed(encodeURI(key), agent) ?? true;
}

export function isIndexable(site: Site, page: Page): boolean {
  const { exclude, prelaunch } = site.config;
  if (
    [...exclude.noindexExpected, ...exclude.ignore].some((p) =>
      matchPath(p, page.key),
    )
  )
    return false;
  if (page.canonical !== undefined && page.canonical.trim() !== "") {
    const target = resolveHref(page.canonical, page.key, site.site);
    if (!target.internal || target.key !== page.key) return false;
  }
  if (prelaunch) return true;
  return (
    !page.robotsMeta.includes("noindex") && isRobotsAllowed(site, page.key)
  );
}
