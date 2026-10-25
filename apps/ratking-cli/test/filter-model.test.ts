// @effect-diagnostics asyncFunction:off -- fast-check asyncModelRun drives Effect programs.
/* oxlint-disable typescript/promise-function-async -- fast-check asyncModelRun is the model boundary. */
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import * as Prefs from "@rat-king/lexicon/attention.prefs";
import { Console, Effect, FileSystem, Schema } from "effect";
import { asyncModelRun } from "fast-check";
import type { AsyncCommand } from "fast-check";
import { expect } from "vitest";

import {
  defaultPreferences,
  defaultStatus,
} from "../../../packages/mailbox-client/src/attention.ts";
import { harness } from "../../../packages/pi-ratking/test/harness.ts";
import { runRatking } from "../src/main.ts";
import { Wiring } from "../src/session.ts";
import { captured, fakeMailbox, people, seeded } from "./fixture.ts";
import type { FakeAttention } from "./fixture.ts";

const Step = Schema.Struct({
  id: Schema.Literals(["one", "two", "three"]),
  op: Schema.Literals(["add", "remove", "list"]),
  route: Schema.Literals(["quiet", "hide", "digest", "wake"]),
});

type StepValue = typeof Step.Type;

interface Model {
  rules: Prefs.RuleValue[];
  writes: number;
}

interface Real {
  readonly attention: FakeAttention;
  readonly calls: readonly { readonly nsid: string }[];
  readonly original: Prefs.MainValue;
  readonly run: (args: readonly string[]) => Promise<string>;
}

const command = (step: StepValue): AsyncCommand<Model, Real> => ({
  check: () => true,
  run: async (model, real) => {
    const plain = {
      id: step.id,
      match: { from: "fleet/*" },
      route: step.route,
    };

    const rule = Schema.decodeUnknownSync(Prefs.Rule)(
      step.route === "digest" ? { ...plain, minutes: 17 } : plain
    );

    const args =
      step.op === "add" ? ["add", JSON.stringify(rule)] : [step.op, step.id];

    await real.run(["filter", ...(step.op === "list" ? ["list"] : args)]);

    if (step.op === "add") {
      model.rules = [
        ...model.rules.filter((held) => held.id !== step.id),
        rule,
      ];
      model.writes += 1;
    }

    if (step.op === "remove") {
      model.rules = model.rules.filter((held) => held.id !== step.id);
      model.writes += 1;
    }

    const prefs = Schema.decodeUnknownSync(Prefs.Main)(real.attention.prefs);
    expect(prefs.rules ?? []).toEqual(model.rules);
    const { rules: _rules, ...rest } = prefs;
    expect(rest).toEqual(real.original);
    expect(
      real.calls.filter((call) => call.nsid.endsWith("putPreferences"))
    ).toHaveLength(model.writes);
    expect(
      real.calls.filter((call) => call.nsid.endsWith("putStatus"))
    ).toHaveLength(0);
  },
  toString: () => JSON.stringify(step),
});

it.live.prop(
  "CLI filter commands follow a model, list is read-only, and every unrelated preference survives RMW unchanged",
  [Schema.Array(Step).check(Schema.isMinLength(1), Schema.isMaxLength(12))],
  ([steps]) =>
    Effect.gen(function* cliModel() {
      const fs = yield* FileSystem.FileSystem;
      const who = yield* people;

      const original = yield* Schema.decodeUnknownEffect(Prefs.Main)({
        ...defaultPreferences(),
        allow: ["peer"],
        log: true,
        model: {
          body: "full",
          jev: { judgment: "keep", laterBp: 1234, nowBp: 5678 },
          kind: "jev",
          timeoutMs: 45_000,
        },
      });

      const attention: FakeAttention = {
        prefs: yield* Schema.decodeUnknownEffect(Schema.Json)(original),
        status: yield* Schema.decodeUnknownEffect(Schema.Json)(defaultStatus()),
      };

      const mailbox = fakeMailbox([], undefined, attention);

      const wiring = harness(
        yield* fs.makeTempDirectoryScoped(),
        mailbox.http,
        [],
        { attentionLevers: true, secrets: seeded(who) }
      );

      const context = yield* Effect.context<NodeServices.NodeServices>();

      const run = async (args: readonly string[]) => {
        const output = captured();
        // oxlint-disable-next-line effect-tests/no-manual-effect-runtime-in-tests -- fast-check commands need a Promise boundary; production effects remain under the test.
        await Effect.runPromiseWith(context)(
          runRatking([...args, "--as", "tester", "--json"]).pipe(
            Effect.provideService(Console.Console, output.console),
            Effect.provideService(Wiring, wiring)
          )
        );

        return output.stdout.join("\n");
      };

      yield* Effect.promise(() =>
        asyncModelRun(
          () => ({
            model: { rules: [], writes: 0 },
            real: { attention, calls: mailbox.calls, original, run },
          }),
          steps.map(command)
        )
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 15 }, timeout: 60_000 }
);
