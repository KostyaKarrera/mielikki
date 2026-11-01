#!/usr/bin/env node
import { Command, CommanderError, Option } from "commander";
import { runCheck, UsageError } from "./commands/check.js";
import { explainRule, listRules, type RulesFormat } from "./commands/rules.js";
import { ConfigError } from "./config/schema.js";
import { VERSION } from "./version.js";

// Exit codes: 0 ok, 1 findings at or above --fail-on, 2 usage/config/launch error.
const EXIT_USAGE = 2;

const format = (): Option =>
  new Option("--format <fmt>", "output format")
    .choices(["text", "json", "md"])
    .default("text");

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("mielikki")
    .description("Local, offline SEO audit CLI")
    .version(VERSION)
    .exitOverride();

  program
    .command("check")
    .description("Audit a built site directory")
    .argument("[dir]", "directory to check (default: config input.dir)")
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
    .exitOverride()
    .action(async (dir: string | undefined, o) => {
      process.exitCode = await runCheck(
        dir,
        {
          config: o.config,
          profile: o.profile,
          format: o.format,
          output: o.output,
          failOn: o.failOn,
          rules: o.rules,
          minSeverity: o.minSeverity,
        },
        {
          cwd: process.cwd(),
          isTTY: process.stdout.isTTY === true,
          write: (s) => {
            process.stdout.write(s);
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
