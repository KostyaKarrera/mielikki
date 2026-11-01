function decode(s: string): string {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
}

/** Canonical page key: decoded, no query/hash, '/x/index.html'|'/x.html'|'/x' -> '/x/'. */
export function pageKey(pathname: string): string {
  let p = decode(pathname.replace(/[?#].*$/s, ""));
  if (!p.startsWith("/")) p = `/${p}`;
  p = p.replace(/\/index\.html?$/i, "/").replace(/\.html?$/i, "");
  if (!p.endsWith("/")) p += "/";
  return p;
}

const HTML_EXT = /\.html?$/i;
const FILE_EXT = /\/[^/]*\.[^/.]+$/;

function keyFromPath(pathname: string): string {
  const decoded = decode(pathname);
  // Non-HTML files (images, pdf, ...) keep their file path as key.
  if (FILE_EXT.test(decoded) && !HTML_EXT.test(decoded)) return decoded;
  return pageKey(pathname);
}

function hostOf(site: string | undefined): string | undefined {
  return site !== undefined && URL.canParse(site)
    ? new URL(site).host.toLowerCase()
    : undefined;
}

export function resolveHref(
  href: string,
  fromKey: string,
  site?: string,
): { internal: boolean; key?: string; external?: string } {
  const h = href.trim();
  if (/^(mailto|tel|javascript|data|sms|whatsapp):/i.test(h))
    return { internal: false };
  const siteHost = hostOf(site);
  const base = `${site !== undefined && URL.canParse(site) ? new URL(site).protocol : "http:"}//${siteHost ?? "mielikki.invalid"}`;
  let url: URL;
  try {
    url = new URL(h, new URL(encodeURI(fromKey), base));
  } catch {
    return { internal: false, external: h };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return { internal: false };
  const absolute = /^([a-z][a-z0-9+.-]*:)?\/\//i.test(h);
  if (
    absolute &&
    (siteHost === undefined || url.host.toLowerCase() !== siteHost)
  )
    return { internal: false, external: h };
  return { internal: true, key: keyFromPath(url.pathname) };
}
