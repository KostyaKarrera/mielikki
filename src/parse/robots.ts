import robotsModule from "robots-parser";

interface RobotsParserResult {
  isAllowed(url: string, ua?: string): boolean | undefined;
  getSitemaps(): string[];
  getCrawlDelay(ua?: string): number | undefined;
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
  /** Crawl-delay in seconds for this agent, if declared and valid. */
  crawlDelay(agent: string): number | undefined;
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
    crawlDelay: (agent) => {
      const d = robots.getCrawlDelay(agent);
      return typeof d === "number" && Number.isFinite(d) && d > 0
        ? d
        : undefined;
    },
    disallowsAll: (agent) =>
      !isAllowed("/", agent) && !isAllowed("/__mielikki_probe__/", agent),
  };
}
