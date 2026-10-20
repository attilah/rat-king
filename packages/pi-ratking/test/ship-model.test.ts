/* oxlint-disable typescript/promise-function-async -- fast-check commands and asyncModelRun are Promise boundaries. */
import { it } from "@effect/vitest";
import { Clock, Duration, Effect, Schema } from "effect";
import { TestClock } from "effect/testing";
import { asyncModelRun } from "fast-check";
import type { AsyncCommand } from "fast-check";
import { expect } from "vitest";
import { initialTransition } from "xstate";

import type { ShipReceipt } from "../../../stacks/nest/ship-config.ts";
import { shipMachine } from "../../../stacks/nest/ship-machine.ts";
import { shipCycle, shipLoop } from "../../../stacks/nest/ship.ts";
import type { ShipPorts, ShipSnapshot } from "../../../stacks/nest/ship.ts";
import { FleetError } from "../../../stacks/nest/stage-config.ts";

const Cycle = Schema.Struct({
  ci: Schema.Boolean,
  elapsed: Schema.Int.check(Schema.isBetween({ maximum: 100, minimum: 0 })),
  outcome: Schema.Literals(["success", "failed", "deferred"]),
  recovery: Schema.Literals(["running", "recovered", "failed", "error"]),
  sha: Schema.Literals(["a".repeat(40), "b".repeat(40), "c".repeat(40)]),
});

interface Model {
  deferred: string;
  failed: string;
  retryAt: number;
  successful: string;
}

interface Real {
  checkpoint: Model;
  deployed: number;
  notes: number;
  receipt: typeof ShipReceipt.Type | undefined;
  receipts: number;
  recoveries: number;
  snapshot: ShipSnapshot;
}

const expectRecovery = (
  cycle: typeof Cycle.Type,
  eligible: boolean,
  recoveries: number,
  receipt: typeof ShipReceipt.Type | undefined
) => {
  const failed = eligible && cycle.outcome === "failed";
  expect(recoveries).toBe(failed ? 1 : 0);

  if (!eligible) {
    return;
  }

  expect(receipt?.recovered).toBe(
    failed && cycle.recovery !== "running"
      ? cycle.recovery === "recovered"
      : undefined
  );
};

class ModelFailure extends Schema.TaggedError<ModelFailure>()("ModelFailure", {
  reason: Schema.String,
}) {}

it.effect.prop(
  "ship serializes deploys, retries busy maintenance, holds a failed SHA until a new SHA and tries recovery after every failed deploy",
  [Schema.Array(Cycle)],
  ([cycles]) =>
    Effect.gen(function* modelRun() {
      const context = yield* Effect.context();

      const command = (
        cycle: typeof Cycle.Type
      ): AsyncCommand<Model, Real> => ({
        check: () => true,
        run: (model, real) => {
          const operation = Effect.gen(function* cycleCommand() {
            yield* TestClock.adjust(Duration.seconds(cycle.elapsed));
            const now = (yield* Clock.currentTimeMillis) / 1000;
            const before = real.deployed;
            const recoveriesBefore = real.recoveries;

            const eligible =
              cycle.ci &&
              cycle.sha !== model.successful &&
              cycle.sha !== model.failed &&
              (cycle.sha !== model.deferred || now >= model.retryAt);

            if (
              cycle.sha !== model.failed &&
              cycle.sha !== model.successful &&
              (cycle.sha !== model.deferred || now >= model.retryAt)
            ) {
              model.deferred = "";
              model.retryAt = 0;
            }

            const ports: ShipPorts = {
              checkpoint: (next) =>
                Effect.sync(() => {
                  real.checkpoint = {
                    deferred: next.deferred ?? "",
                    failed: next.failed,
                    retryAt: next.retryAt ?? 0,
                    successful: next.successful,
                  };
                }),
              ci: () => Effect.succeed(cycle.ci),
              deploy: () =>
                Effect.sync(() => {
                  expect(real.checkpoint.failed).toBe(cycle.sha);
                  real.deployed += 1;

                  return {
                    celldRestarted: false,
                    restartSeconds: 0,
                    result: cycle.outcome,
                    retryAt: now + 90,
                  };
                }),
              fetch: Effect.succeed(cycle.sha),
              notify: () =>
                Effect.sync(() => {
                  real.notes += 1;
                }),
              record: (receipt) =>
                Effect.sync(() => {
                  real.receipt = receipt;
                  real.receipts += 1;
                }),
              recover: Effect.suspend(() => {
                real.recoveries += 1;

                return cycle.recovery === "error"
                  ? Effect.fail(new FleetError({ reason: "unreachable" }))
                  : Effect.succeed(cycle.recovery);
              }),
            };

            real.snapshot = yield* shipCycle(real.snapshot, ports);

            if (eligible) {
              model.deferred = cycle.outcome === "deferred" ? cycle.sha : "";
              model.retryAt = cycle.outcome === "deferred" ? now + 90 : 0;
            }

            if (eligible && cycle.outcome === "success") {
              model.successful = cycle.sha;
              model.failed = "";
            }

            if (eligible && cycle.outcome === "failed") {
              model.failed = cycle.sha;
            }

            expect(real.deployed - before).toBe(eligible ? 1 : 0);
            expectRecovery(
              cycle,
              eligible,
              real.recoveries - recoveriesBefore,
              real.receipt
            );

            expect(real.snapshot.context.successful).toBe(model.successful);
            expect(real.snapshot.context.failed).toBe(model.failed);
            expect(real.snapshot.context.deferred).toBe(model.deferred);
            expect(real.snapshot.context.retryAt).toBe(model.retryAt);
            expect(real.checkpoint.failed).toBe(model.failed);
            expect(real.checkpoint.successful).toBe(model.successful);

            if (eligible) {
              expect(real.checkpoint).toEqual(model);
            }

            expect(real.receipts).toBe(real.deployed);
            expect(real.notes).toBe(real.deployed);
          });

          // oxlint-disable-next-line effect-tests/no-manual-effect-runtime-in-tests -- asyncModelRun needs a Promise per command; reuse the test context.
          return Effect.runPromiseWith(context)(operation);
        },
        toString: () => JSON.stringify(cycle),
      });

      const [snapshot] = initialTransition(shipMachine, {
        failed: "",
        successful: "",
      });

      yield* Effect.tryPromise({
        catch: () => new ModelFailure({ reason: "Ship model diverged" }),
        try: () =>
          asyncModelRun(
            () => ({
              model: { deferred: "", failed: "", retryAt: 0, successful: "" },
              real: {
                checkpoint: {
                  deferred: "",
                  failed: "",
                  retryAt: 0,
                  successful: "",
                },
                deployed: 0,
                notes: 0,
                receipt: undefined,
                receipts: 0,
                recoveries: 0,
                snapshot,
              },
            }),
            cycles.map(command)
          ),
      });
    })
);

it.live.prop(
  "the ship loop runs until its own code changes and then exits, never before",
  [Schema.Int.check(Schema.isBetween({ maximum: 5, minimum: 1 }))],
  ([changesAt]) =>
    Effect.gen(function* runnerDriftProof() {
      let cycles = 0;
      let fetches = 0;
      const sha = "a".repeat(40);

      const ports: ShipPorts = {
        checkpoint: () => Effect.void,
        ci: () => Effect.succeed(true),
        deploy: () =>
          Effect.succeed({
            celldRestarted: false,
            restartSeconds: 0,
            result: "success",
          }),
        fetch: Effect.sync(() => {
          fetches += 1;

          return sha;
        }),
        notify: () => Effect.void,
        record: () => Effect.void,
        recover: Effect.succeed("running"),
      };

      yield* shipLoop(
        ports,
        { failed: "", successful: sha },
        0,
        Effect.sync(() => {
          cycles += 1;

          return cycles >= changesAt;
        })
      );

      expect(cycles).toBe(changesAt);
      expect(fetches).toBe(changesAt);
    }),
  { timeout: 30_000 }
);

it.effect.prop(
  "fetch errors never reach failed, never mark a sha failed and back off between retries",
  [
    Schema.Array(
      Schema.Int.check(Schema.isBetween({ maximum: 4000, minimum: 0 }))
    ),
  ],
  ([gaps]) =>
    Effect.gen(function* fetchErrors() {
      const [initial] = initialTransition(shipMachine, {
        failed: "",
        successful: "",
      });

      let snapshot: ShipSnapshot = initial;
      let fetches = 0;
      let reachedFailed = false;

      const ports: ShipPorts = {
        checkpoint: () => Effect.void,
        ci: () => Effect.succeed(true),
        deploy: () => Effect.die("no deploy"),
        fetch: Effect.suspend(() => {
          fetches += 1;

          return Effect.fail(new FleetError({ reason: "network" }));
        }),
        notify: () => Effect.void,
        record: () => Effect.void,
        recover: Effect.succeed("running"),
      };

      for (const gap of gaps) {
        yield* TestClock.adjust(Duration.seconds(gap));
        const before = fetches;
        const wasWaiting = snapshot.matches("fetch-error");
        const now = (yield* Clock.currentTimeMillis) / 1000;
        const due = !wasWaiting || now >= snapshot.context.fetchRetryAt;
        snapshot = yield* shipCycle(snapshot, ports);
        reachedFailed ||= snapshot.matches("failed");
        expect(fetches - before).toBe(due ? 1 : 0);
        expect(snapshot.matches("fetch-error")).toBe(true);
        expect(snapshot.context.failed).toBe("");
      }

      expect(reachedFailed).toBe(false);
    })
);
