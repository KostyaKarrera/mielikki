function privateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10/8
    a === 127 || // loopback 127/8
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12
    (a === 192 && b === 168) || // 192.168/16
    (a === 169 && b === 254) // link-local 169.254/16
  );
}

/**
 * True for hosts that can never be a production site: localhost, `*.localhost`,
 * `*.local`, IPv6 loopback and loopback/private/link-local IPv4. Accepts a URL
 * hostname (`[::1]`) or a host with a port (`localhost:4321`).
 */
export function isLocalHost(host: string): boolean {
  let h = host.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    h = h.slice(1, end < 0 ? undefined : end);
  } else {
    h = h.replace(/:\d*$/, "");
  }
  h = h.replace(/\.$/, "");
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h === "::1" ||
    privateIPv4(h)
  );
}

/** True when `url` is an absolute http(s) URL on a local/private host (see isLocalHost). */
export function isLocalUrl(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const u = new URL(url);
  return (
    (u.protocol === "http:" || u.protocol === "https:") &&
    isLocalHost(u.hostname)
  );
}
