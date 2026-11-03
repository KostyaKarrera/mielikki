import path from "node:path";

/** `${XDG_CONFIG_HOME ?? home/.config}/mielikki/gsc-token.json` */
export function tokenPath(env: NodeJS.ProcessEnv, home: string): string {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(home, ".config");
  return path.join(base, "mielikki", "gsc-token.json");
}
