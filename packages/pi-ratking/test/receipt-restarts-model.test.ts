/* oxlint-disable typescript/promise-function-async, effect-tests/no-manual-effect-runtime-in-tests -- fast-check commands bridge Effect.sync through the test context to asyncModelRun. */
import { it } from "@effect/vitest";
import { Effect, Match, Schema } from "effect";
import { asyncModelRun } from "fast-check";
import type { AsyncCommand } from "fast-check";
import { expect } from "vitest";

import {
  emptySources,
  observeAlarms,
  RESTART_MEMORY_MS,
} from "../../../stacks/nest/alarm-sources.ts";
import type {
  AlarmFacts,
  SourceState,
} from "../../../stacks/nest/alarm-sources.ts";
import type { ShipReceipt } from "../../../stacks/nest/ship-config.ts";
import {
  deployOutcome,
  observedRestartEvent,
  restartOutcome,
} from "../../../stacks/nest/ship-observation.ts";

const LegacyRestartEvent = Schema.Struct({
  durationSeconds: Schema.Number,
  phase: Schema.Literals(["requested", "completed", "deferred"]),
  restarted: Schema.NullOr(Schema.Boolean),
  retryAt: Schema.optionalKey(Schema.Number),
});

const Input = Schema.Struct({
  downtimeMillis: Schema.Int.check(
    Schema.isBetween({ maximum: 120_000, minimum: 1 })
  ),
  gateClaimsRestart: Schema.Boolean,
  outsideMillis: Schema.Int.check(
    Schema.isBetween({ maximum: 60_000, minimum: 1 })
  ),
  pidReused: Schema.Boolean,
  receiptClaim: Schema.NullOr(Schema.Boolean),
  result: Schema.Literals(["success", "failed", "deferred"]),
});

interface Model {
  entered: number;
  unexplained: number[];
}

interface Real {
  facts: typeof AlarmFacts.Type;
  sources: typeof SourceState.Type;
}

const check = (model: Model, real: Real, now: number) => {
  const observed = observeAlarms(real.sources, real.facts, now);
  real.sources = observed.sources;
  expect(observed.sources.entered).toBe(model.entered);
  expect(observed.sources.unexplained).toEqual(model.unexplained);
  expect(observed.readings["celld.restarted"].status).toBe(
    model.unexplained.length === 0 ? "ok" : "firing"
  );
};

class ModelFailure extends Schema.TaggedError<ModelFailure>()("ModelFailure", {
  reason: Schema.String,
}) {}

it.effect.prop(
  "attempt readback owns restart accounting; receipts explain only starts in their window, including delayed receipts, never later unplanned starts",
  [Input],
  ([input]) =>
    Effect.gen(function* modelRun() {
      const context = yield* Effect.context();

      const command = (
        name: string,
        run: (model: Model, real: Real) => void
      ): AsyncCommand<Model, Real> => ({
        check: () => true,
        run: (model, real) =>
          Effect.runPromiseWith(context)(
            Effect.sync(() => {
              run(model, real);
            })
          ),
        toString: () => name,
      });

      const initial = 1_000_000;
      const start = initial + 60_000;
      const end = start + input.downtimeMillis + 1000;
      const sha = "a".repeat(40);
      const commands: AsyncCommand<Model, Real>[] = [];

      for (const changed of [false, true]) {
        commands.push(
          command(`deploy changed=${changed}`, (model, real) => {
            const before = {
              active: true,
              enteredMicros: 1_000_000,
              exitedMicros: 0,
              pid: 42,
            };

            const after = changed
              ? {
                  active: true,
                  enteredMicros: 2_000_000 + input.downtimeMillis * 1000,
                  exitedMicros: 2_000_000,
                  pid: input.pidReused ? 42 : 43,
                }
              : before;

            const gate = {
              durationSeconds: 0,
              phase:
                input.result === "deferred"
                  ? ("deferred" as const)
                  : ("completed" as const),
              restarted: input.gateClaimsRestart,
              retryAt: end / 1000 + 60,
            };

            const observation = observedRestartEvent([gate], before, after);

            const legacy = Schema.decodeSync(
              Schema.fromJsonString(LegacyRestartEvent)
            )(JSON.stringify(observation));

            expect(legacy).toEqual({
              durationSeconds: 0,
              phase: gate.phase,
              restarted: null,
              retryAt: gate.retryAt,
            });

            const measured = deployOutcome(input.result === "success" ? 0 : 1, [
              gate,
              observation,
            ]);

            expect(measured).toEqual({
              celldRestarted: changed,
              restartSeconds: changed ? input.downtimeMillis / 1000 : 0,
              result: input.result,
              retryAt: end / 1000 + 60,
            });

            if (changed) {
              model.entered = start + input.downtimeMillis;
              model.unexplained.push(model.entered);
            }

            real.facts = { ...real.facts, entered: model.entered };
            check(model, real, end);
          })
        );
      }

      commands.push(
        command("publish delayed attempt receipt", (model, real) => {
          const receipt: typeof ShipReceipt.Type = {
            celldRestarted: input.receiptClaim,
            end: end / 1000,
            restartSeconds: input.receiptClaim === null ? null : 0,
            result: input.result,
            sha,
            start: start / 1000,
          };

          model.unexplained = [];
          real.facts = { ...real.facts, receipts: [receipt] };
          check(model, real, end + 1);
        }),
        command(
          "unplanned start strictly after attempt window",
          (model, real) => {
            model.entered = end + input.outsideMillis;
            model.unexplained.push(model.entered);
            real.facts = { ...real.facts, entered: model.entered };
            check(model, real, model.entered);
            real.facts = {
              ...real.facts,
              deploy: { phase: "restarting", sha, started: start / 1000 },
            };
            check(model, real, model.entered + 1);
          }
        ),
        command("retain existing one-hour restart memory", (model, real) => {
          check(model, real, model.entered + RESTART_MEMORY_MS - 1);
          model.unexplained = [];
          check(model, real, model.entered + RESTART_MEMORY_MS);
        })
      );

      yield* Effect.tryPromise({
        catch: () =>
          new ModelFailure({ reason: "Receipt restart model diverged" }),
        try: () =>
          asyncModelRun(
            () => ({
              model: { entered: initial, unexplained: [] },
              real: {
                facts: {
                  cacheBreaches: null,
                  deploy: null,
                  deployKnown: true,
                  digest: "ok" as const,
                  doctor: true,
                  entered: initial,
                  health: 200,
                  measurementFailed: false,
                  quarantinedHour: 0,
                  readers: null,
                  receipts: [],
                  receiptsKnown: true,
                  slots: null,
                },
                sources: { ...emptySources, entered: initial },
              },
            }),
            commands
          ),
      });
    })
);

it.prop(
  "missing process evidence stays unknown; a known restart without a valid stop timestamp never reports zero downtime",
  [
    Schema.Literals([
      "before-missing",
      "after-missing",
      "inactive",
      "exit-missing",
      "exit-later",
      "pid-only",
    ]),
  ],
  ([kind]) => {
    const before = {
      active: true,
      enteredMicros: 1_000_000,
      exitedMicros: 0,
      pid: 42,
    };

    const exitedMicros = Match.value(kind).pipe(
      Match.when("exit-missing", () => 0),
      Match.when("exit-later", () => 4_000_000),
      Match.orElse(() => 500_000)
    );

    const after = {
      active: kind !== "inactive",
      enteredMicros: kind === "pid-only" ? before.enteredMicros : 3_000_000,
      exitedMicros,
      pid: 43,
    };

    const observed = observedRestartEvent(
      [],
      kind === "before-missing" ? null : before,
      kind === "after-missing" ? null : after
    );

    const known =
      kind === "exit-missing" || kind === "exit-later" || kind === "pid-only";

    expect(restartOutcome([observed])).toEqual({
      celldRestarted: known ? true : null,
      restartSeconds: kind === "pid-only" ? 0.5 : null,
    });
  }
);
