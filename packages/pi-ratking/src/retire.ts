import { AgentName } from "@rat-king/ratking-client/name";
import { RatKing } from "@rat-king/ratking-client/ratking";
import type { NotDelivered } from "@rat-king/ratking-client/ratking";
import { Effect, Match, Option, Schema } from "effect";

import { retireOwn } from "./tool.ts";

export const RETIRE_COMMAND = "ratking-retire";

export const RETIRE_COMMAND_DESCRIPTION =
  "Retire this Pi's Rat King name to a successor and stop its reader: /ratking-retire <successor>";

export interface Retirement {
  readonly name: string;
  readonly successor: string;
  readonly aliases: readonly string[];
}

export interface RetireOutcome {
  readonly line: string;
  readonly retired?: Retirement;
}

const oneLine = (text: string) =>
  text
    .replaceAll(/\p{Cc}+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();

export const retiredLine = (name: string, successor: string) =>
  oneLine(`ratking retired ${name} -> ${successor}`);

export const refusedLine = (what: string, why: string, next: string) =>
  `ratking retire refused: ${oneLine(what)} | ${oneLine(why) || "no reason given"} | ${oneLine(next)}`;

const refused = (what: string, why: string, next: string): RetireOutcome => ({
  line: refusedLine(what, why, next),
});

const USAGE = "run /ratking-retire <project/row>";

const isName = (name: string) =>
  Option.isSome(Schema.decodeOption(AgentName)(name));

const checkedSuccessor = (args: string) => {
  const wanted = args.trim();

  if (wanted === "") {
    return Option.some(
      refused("successor missing", "no successor name was given", USAGE)
    );
  }

  return isName(wanted)
    ? Option.none()
    : Option.some(
        refused(
          `successor ${wanted} is not a Rat King name`,
          "names look like project/row or row",
          USAGE
        )
      );
};

export const noNameOutcome = (reason: string) =>
  refused(
    "this Pi has no Rat King name",
    reason,
    "retire from the Pi that holds the name"
  );

export const againOutcome = (
  args: string,
  prior: Retirement
): RetireOutcome => {
  const invalid = checkedSuccessor(args);

  if (Option.isSome(invalid)) {
    return invalid.value;
  }

  const wanted = args.trim();

  return wanted === prior.successor || prior.aliases.includes(wanted)
    ? { line: retiredLine(prior.name, prior.successor), retired: prior }
    : refused(
        `${prior.name} already retired to ${prior.successor}`,
        "one retirement names one successor",
        `run /ratking-retire ${prior.successor}, or start a new session under ${prior.name} to clear it`
      );
};

const notDeliveredOutcome = (error: NotDelivered) =>
  Match.value(error.code).pipe(
    Match.when("NoIdentity", () => noNameOutcome(error.reason)),
    Match.when("Uncertain", () =>
      refused(
        "mailbox unreachable",
        error.reason,
        "retry /ratking-retire when the mailbox answers"
      )
    ),
    Match.orElse(() =>
      refused(
        "name authority refused the retire",
        `${error.code}: ${error.reason}`,
        "check ratking status, then retry"
      )
    )
  );

export const retireCommand = Effect.fn("RatKing.retireCommand")(
  function* retireCommand(args: string) {
    const invalid = checkedSuccessor(args);

    if (Option.isSome(invalid)) {
      return invalid.value;
    }

    const wanted = args.trim();
    const ratking = yield* RatKing;
    const status = yield* ratking.status;

    const entry = (yield* ratking.list).find(
      (listed) => listed.name === wanted || listed.aliases.includes(wanted)
    );

    if (entry === undefined) {
      return refused(
        `successor ${wanted} is unknown`,
        "the Rat King directory has no such name",
        "check the name with ratking list, then retry"
      );
    }

    if (Option.exists(status.self, (own) => own.name === entry.name)) {
      return refused(
        `successor ${wanted} is this Pi's own name`,
        "a name cannot succeed itself",
        USAGE
      );
    }

    const retired = yield* retireOwn(ratking, entry.name);

    const retirement: Retirement = {
      aliases: entry.aliases,
      name: retired.name,
      successor: retired.successor ?? entry.name,
    };

    return {
      line: retiredLine(retirement.name, retirement.successor),
      retired: retirement,
    };
  },
  Effect.catchTags({
    NotDelivered: (error) => Effect.succeed(notDeliveredOutcome(error)),
  })
);
