import {
  FilterInput,
  filterHits,
  filterLines,
  filterRules,
} from "@rat-king/ratking-client/attention";
import { Inbox } from "@rat-king/ratking-client/ratking";
import { Effect, Schema } from "effect";
import { Argument, Command } from "effect/cli";

import { Usage } from "./faults.ts";
import { commonFlags, named } from "./session.ts";

const refusal = (reason: string) =>
  new Usage({
    accepted: "add <rule-json>, remove <id>, list",
    fix: "ratking filter list",
    reason,
  });

type FilterRequest = Schema.Json;

const runFilter = (input: FilterRequest) =>
  Effect.gen(function* runFilterOperation() {
    const inbox = yield* Inbox;
    const decoded = yield* Schema.decodeUnknownEffect(FilterInput)(input);
    const rules = yield* filterRules(inbox.change, decoded);
    const hits = yield* filterHits;

    return { document: { hits, rules }, lines: filterLines(rules, hits) };
  }).pipe(Effect.mapError((failure) => refusal(String(failure))));

const add = Command.make(
  "add",
  { ...commonFlags, rule: Argument.String("rule-json") },
  (args) =>
    named("filter add", args, () =>
      Effect.gen(function* addRule() {
        const rule = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(Schema.Json)
        )(args.rule).pipe(
          Effect.mapError((failure) => refusal(String(failure)))
        );

        return yield* runFilter({ op: "add", rule });
      })
    )
);

const remove = Command.make(
  "remove",
  { ...commonFlags, id: Argument.String("id") },
  (args) =>
    named("filter remove", args, () => runFilter({ id: args.id, op: "remove" }))
);

const list = Command.make("list", commonFlags, (args) =>
  named("filter list", args, () => runFilter({ op: "list" }))
);

export const filterCommand = Command.make("filter").pipe(
  Command.withDescription(
    "Receiver wake/display rules: add <rule-json>, remove <id>, list with local hits and expiry."
  ),
  Command.withSubcommands([add, remove, list])
);
