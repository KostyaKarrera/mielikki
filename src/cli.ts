#!/usr/bin/env node
import {
  Command,
  CommanderError,
  InvalidArgumentError,
  Option,
} from "commander";
import { runCheck } from "./commands/check.js";
import { runInit } from "./commands/init.js";
import { runPerf } from "./commands/perf.js";
import { explainRule, listRules, type RulesFormat } from "./commands/rules.js";
import { ConfigError } from "./config/schema.js";
import { UsageError } from "./errors.js";
import { VERSION } from "./version.js";

// Exit codes: 0 ok, 1 findings at or above --fail-on, 2 usage/config/launch error.
const EXIT_USAGE = 2;

const format = (): Option =>
  new Option("--format <fmt>", "output format")
    .choices(["text", "json", "md"])
    .default("text");

/** Largest delay a Node.js timer accepts (2^31-1 ms). */
const MAX_MS = 2_147_483_647;

/** Parser for a non-negative integer option value (min 1 when `positive`, at most `max`). */
const int =
  (positive: boolean, max = Number.MAX_SAFE_INTEGER) =>
  (v: string): number => {
    const n = Number(v);
    if (
      !/^\d+$/.test(v.trim()) ||
      !Number.isSafeInteger(n) ||
      (positive && n < 1)
    )
      throw new InvalidArgumentError(
        positive ? "expected a positive integer" : "expected an integer ≥ 0",
      );
    if (n > max) throw new InvalidArgumentError(`expected at most ${max}`);
    return n;
  };

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("mielikki")
    .description("Local, offline SEO audit CLI")
    .version(VERSION)
    .exitOverride();

  program
    .command("check")
    .description("Audit a built site directory or a running site (http(s) URL)")
    .argument(
      "[target]",
      "directory or http(s) URL to check (default: config input.dir)",
    )
    .option("--config <path>", "path to config file")
    .addOption(
      new Option("--profile <p>", "dev or launch")
        .choices(["dev", "launch"])
        .default("dev"),
    )
    .addOption(format())
    .option("--output <file>", "write the report to a file")
    .addOption(
      new Option("--fail-on <sev>", "exit 1 on findings at or above")
        .choices(["error", "warning", "info"])
        .default("error"),
    )
    .option("--rules <mask,...>", "run only rules matching these masks")
    .addOption(
      new Option("--min-severity <sev>", "hide findings below (text format)")
        .choices(["error", "warning", "info"])
        .default("info"),
    )
    .option("--max-pages <n>", "URL mode: max pages to crawl (200)", int(true))
    .option(
      "--max-assets <n>",
      "URL mode: max assets to check (300)",
      int(false),
    )
    .option(
      "--concurrency <n>",
      "URL mode: parallel requests (4 local, 2 otherwise)",
      int(true),
    )
    .option(
      "--delay <ms>",
      "URL mode: pause between requests (0 local, 100 otherwise)",
      int(false, MAX_MS),
    )
    .option(
      "--timeout <ms>",
      "URL mode: per-request timeout (15000)",
      int(true, MAX_MS),
    )
    .option(
      "--max-bytes <n>",
      "URL mode: max response body size (5000000)",
      int(true),
    )
    .option("--respect-robots", "URL mode: skip URLs disallowed by robots.txt")
    .exitOverride()
    .action(async (target: string | undefined, o) => {
      process.exitCode = await runCheck(
        target,
        {
          config: o.config,
          profile: o.profile,
          format: o.format,
          output: o.output,
          failOn: o.failOn,
          rules: o.rules,
          minSeverity: o.minSeverity,
          maxPages: o.maxPages,
          maxAssets: o.maxAssets,
          concurrency: o.concurrency,
          delay: o.delay,
          timeout: o.timeout,
          maxBytes: o.maxBytes,
          respectRobots: o.respectRobots === true,
        },
        {
          cwd: process.cwd(),
          isTTY: process.stdout.isTTY === true,
          write: (s) => {
            process.stdout.write(s);
          },
          warn: (s) => {
            process.stderr.write(`${s}\n`);
          },
        },
      );
    });

  program
    .command("perf")
    .description(
      "Measure Lighthouse performance of running pages (needs lighthouse and chrome-launcher installed; results vary between runs)",
    )
    .argument("<url...>", "http(s) page URLs to measure")
    .option("--config <path>", "path to config file")
    .addOption(
      new Option("--preset <p>", "mobile or desktop")
        .choices(["mobile", "desktop"])
        .default("mobile"),
    )
    .option("--runs <n>", "runs per URL; the median is reported", int(true), 1)
    .option(
      "--chrome-path <path>",
      "Chrome executable (default: CHROME_PATH or autodetect)",
    )
    .option("--no-sandbox", "start Chrome with --no-sandbox (containers, CI)")
    .addOption(format())
    .option("--output <file>", "write the report to a file")
    .addOption(
      new Option("--fail-on <sev>", "exit 1 on findings at or above")
        .choices(["error", "warning", "info"])
        .default("error"),
    )
    .exitOverride()
    .action(async (urls: string[], o) => {
      process.exitCode = await runPerf(
        urls,
        {
          config: o.config,
          preset: o.preset,
          runs: o.runs,
          chromePath: o.chromePath,
          // commander's --no-sandbox sets `sandbox` (default true)
          noSandbox: o.sandbox === false,
          format: o.format,
          output: o.output,
          failOn: o.failOn,
        },
        {
          cwd: process.cwd(),
          isTTY: process.stdout.isTTY === true,
          write: (s) => {
            process.stdout.write(s);
          },
          warn: (s) => {
            process.stderr.write(`${s}\n`);
          },
        },
      );
    });

  const rules = program
    .command("rules")
    .description("List rules")
    .addOption(format())
    .exitOverride()
    .action((o) => {
      process.stdout.write(listRules(o.format as RulesFormat));
    });
  rules
    .command("explain")
    .description("Explain one rule")
    .argument("<id>", "rule id")
    .exitOverride()
    .action((id: string) => {
      process.stdout.write(explainRule(id));
    });

  program
    .command("init")
    .description("Create mielikki.config.yaml, autodetecting from a build")
    .argument("[dir]", "build directory to inspect", "dist")
    .option("--site <url>", "production site URL")
    .addOption(
      new Option("--language <lang>", "content language").choices([
        "fi",
        "sv",
        "en",
      ]),
    )
    .addOption(
      new Option("--business-type <type>", "business type").choices([
        "brick-and-mortar",
        "service-area",
        "hybrid",
      ]),
    )
    .option("--schema-type <type>", "schema.org business type")
    .option("--force", "overwrite an existing config")
    .exitOverride()
    .action(async (dir: string, o) => {
      process.exitCode = await runInit(
        dir,
        {
          site: o.site,
          language: o.language,
          businessType: o.businessType,
          schemaType: o.schemaType,
          force: o.force === true,
        },
        {
          cwd: process.cwd(),
          write: (s) => {
            process.stdout.write(s);
          },
          warn: (s) => {
            process.stderr.write(`${s}\n`);
          },
        },
      );
    });

  return program;
}

async function main(argv: string[]): Promise<void> {
  try {
    await buildProgram().parseAsync(argv);
  } catch (err) {
    if (err instanceof CommanderError) {
      process.exitCode = err.exitCode === 0 ? 0 : EXIT_USAGE;
      return;
    }
    const msg =
      err instanceof ConfigError || err instanceof UsageError
        ? err.message
        : `Internal error: ${err instanceof Error ? err.message : String(err)}`;
    process.stderr.write(`mielikki: ${msg.split("\n")[0]}\n`);
    process.exitCode = EXIT_USAGE;
  }
}

await main(process.argv);
