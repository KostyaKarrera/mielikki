import robotsModule from "robots-parser";

interface RobotsParserResult {
  isAllowed(url: string, ua?: string): boolean | undefined;
  getSitemaps(): string[];
}

// robots-parser is CommonJS (`module.exports = fn`) but ships ESM-style typings.
const robotsParser = robotsModule as unknown as (
  url: string,
  txt: string,
) => RobotsParserResult;

export interface RobotsInfo {
  raw: string;
  sitemaps: string[];
  isAllowed(path: string, agent: string): boolean;
  disallowsAll(agent: string): boolean;
}

export function parseRobots(raw: string, site?: string): RobotsInfo {
  const origin =
    site !== undefined && URL.canParse(site) ? site : "http://localhost";
  const base = new URL("/robots.txt", origin).href;
  const robots = robotsParser(base, raw);
  const isAllowed = (path: string, agent: string): boolean =>
    robots.isAllowed(new URL(path, base).href, agent) !== false;
  return {
    raw,
    sitemaps: robots.getSitemaps(),
    isAllowed,
    disallowsAll: (agent) =>
      !isAllowed("/", agent) && !isAllowed("/__mielikki_probe__/", agent),
  };
}
