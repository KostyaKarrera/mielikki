#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { VERSION } from "./version.js";

const EXIT_USAGE = 2;

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("mielikki")
    .description("Local, offline SEO audit CLI")
    .version(VERSION)
    .argument("[command]")
    .exitOverride()
    .action((command?: string) => {
      if (command !== undefined) {
        program.error(`error: unknown command '${command}'`, {
          exitCode: EXIT_USAGE,
          code: "commander.unknownCommand",
        });
      }
      program.outputHelp();
    });
  return program;
}

function main(argv: string[]): void {
  const program = buildProgram();
  try {
    program.parse(argv);
  } catch (err) {
    if (err instanceof CommanderError) {
      const usage =
        err.code === "commander.unknownCommand" || err.exitCode === 1;
      process.exitCode = usage ? EXIT_USAGE : err.exitCode;
      return;
    }
    throw err;
  }
}

main(process.argv);
