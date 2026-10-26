import { Console, Effect, Predicate } from "effect";
import { CliError } from "effect/cli";
import type { Command } from "effect/cli";

export type UsageError = Exclude<CliError.CliError, CliError.UserError>;

export const isUsageError = (error: unknown): error is UsageError =>
  CliError.isCliError(error) && !Predicate.isTagged(error, "UserError");

export const refuseUsage = (
  command: Command.Command.Any,
  args: readonly string[]
) =>
  Effect.fn("MailboxCli.refuseUsage")(function* renderUsage(
    failure: UsageError
  ) {
    const path = [command.name];
    let active = command;

    for (const arg of args) {
      const child = active.subcommands
        .flatMap((group) => group.commands)
        .find((candidate) => candidate.name === arg || candidate.alias === arg);

      if (child === undefined) {
        break;
      }

      path.push(child.name);
      active = child;
    }

    let failed = path.join(" ");
    let why = failure.message;

    if (Predicate.isTagged(failure, "ShowHelp")) {
      failed = failure.commandPath.join(" ");
      why =
        failure.errors.length === 0
          ? "A subcommand is required"
          : failure.errors.map((problem) => problem.message).join("; ");
    }

    yield* Console.error(
      JSON.stringify({
        failed,
        next: `Run ${failed} --help, then correct the command or flags`,
        why,
      })
    );
    yield* Effect.sync(() => {
      process.exitCode = 2;
    });
  });
