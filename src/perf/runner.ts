import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { UsageError } from "../errors.js";
import type { LhrSubset } from "./lhr.js";

export type LighthouseRunner = (
  url: string,
  o: {
    preset: "mobile" | "desktop";
    chromePath?: string;
    noSandbox: boolean;
  },
) => Promise<LhrSubset>;

/** Loads a module by name; `fromCwd` resolves it from the user's project. */
export type ModuleLoader = (name: string, fromCwd: boolean) => Promise<unknown>;

const defaultLoader: ModuleLoader = async (name, fromCwd) => {
  if (!fromCwd) return import(name);
  const req = createRequire(`${path.resolve(process.cwd())}${path.sep}`);
  return import(pathToFileURL(req.resolve(name)).href);
};

const INSTALL_HINT =
  "mielikki perf needs Lighthouse and Chrome: install with `npm i -D lighthouse chrome-launcher` (Node 22.19+ for Lighthouse 13) and have Google Chrome installed, or set CHROME_PATH / --chrome-path.";

async function loadModule(name: string, load: ModuleLoader): Promise<unknown> {
  try {
    return await load(name, false);
  } catch {
    try {
      return await load(name, true);
    } catch {
      throw new UsageError(`${name} not found. ${INSTALL_HINT}`);
    }
  }
}

const def = <T>(m: unknown): T => {
  const mod = m as { default?: unknown };
  return (mod.default ?? m) as T;
};

type ChromeLauncher = {
  launch(o: {
    chromeFlags: string[];
    chromePath?: string;
  }): Promise<{ port: number; kill(): Promise<void> | void }>;
};
type LighthouseFn = (
  url: string,
  flags: Record<string, unknown>,
) => Promise<{ lhr: LhrSubset } | undefined>;

const MOBILE_EMULATION = {
  mobile: true,
  width: 412,
  height: 823,
  deviceScaleFactor: 1.75,
  disabled: false,
};
const DESKTOP_EMULATION = {
  mobile: false,
  width: 1350,
  height: 940,
  deviceScaleFactor: 1,
  disabled: false,
};
const DESKTOP_THROTTLING = {
  rttMs: 40,
  throughputKbps: 10240,
  cpuSlowdownMultiplier: 1,
  requestLatencyMs: 0,
  downloadThroughputKbps: 0,
  uploadThroughputKbps: 0,
};

export async function loadLighthouseRunner(
  load: ModuleLoader = defaultLoader,
): Promise<LighthouseRunner> {
  const lighthouse = def<LighthouseFn>(await loadModule("lighthouse", load));
  const launcher = (await loadModule(
    "chrome-launcher",
    load,
  )) as ChromeLauncher & {
    default?: ChromeLauncher;
  };
  const cl =
    typeof launcher.launch === "function" ? launcher : launcher.default;
  const launch = cl?.launch.bind(cl);
  if (typeof lighthouse !== "function" || launch === undefined)
    throw new UsageError(
      `Unsupported lighthouse/chrome-launcher version. ${INSTALL_HINT}`,
    );

  return async (url, o) => {
    const chromeFlags = ["--headless=new"];
    if (o.noSandbox) chromeFlags.push("--no-sandbox");
    let chrome: Awaited<ReturnType<ChromeLauncher["launch"]>>;
    try {
      chrome = await launch({ chromeFlags, chromePath: o.chromePath });
    } catch (e) {
      throw new UsageError(
        `Could not start Chrome (${e instanceof Error ? e.message.split("\n")[0] : String(e)}). Install Google Chrome or set CHROME_PATH / --chrome-path.`,
      );
    }
    try {
      const desktop = o.preset === "desktop";
      const r = await lighthouse(url, {
        port: chrome.port,
        output: "json",
        logLevel: "error",
        onlyCategories: ["performance"],
        formFactor: o.preset,
        screenEmulation: desktop ? DESKTOP_EMULATION : MOBILE_EMULATION,
        ...(desktop ? { throttling: DESKTOP_THROTTLING } : {}),
      });
      if (!r) throw new Error("Lighthouse returned no result");
      if (r.lhr.runtimeError)
        throw new Error(
          `${r.lhr.runtimeError.code}: ${r.lhr.runtimeError.message}`,
        );
      return r.lhr;
    } finally {
      await chrome.kill();
    }
  };
}
