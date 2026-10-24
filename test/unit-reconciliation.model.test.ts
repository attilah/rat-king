/* oxlint-disable typescript/promise-function-async, effect-tests/no-manual-effect-runtime-in-tests -- asyncModelRun bridges commands through the owning test context. */
import { it } from "@effect/vitest";
import { Arbitrary, Effect, Result, Schema } from "effect";
import * as fc from "fast-check";
import type { AsyncCommand } from "fast-check";
import { expect } from "vitest";

import { stageOwnedUnit } from "../../../stacks/nest/ship-unit-stage.ts";
import { makeFakeShell } from "../src/fake-shell.ts";
import { reconcileUnit } from "../src/systemd.ts";
import type { UnitProps } from "../src/systemd.ts";

const Revision = Schema.Int.check(Schema.isBetween({ maximum: 2, minimum: 0 }));

const Cycle = Schema.Struct({
  cascade: Schema.Boolean,
  inputs: Revision,
  known: Schema.Boolean,
  proved: Schema.Boolean,
  reload: Schema.Boolean,
  staged: Schema.Boolean,
  started: Schema.Boolean,
  version: Revision,
});

const props = (
  version: number,
  inputs: number,
  started: boolean
): UnitProps => ({
  home: "/home/example",
  name: "fixture.invalid.service",
  restartOn: [`input-${inputs}`],
  scope: "user",
  sections: [
    { lines: [["ExecStart", `/opt/version-${version}`]], name: "Service" },
  ],
  started,
});

interface Model {
  active: boolean;
  inputs: number;
  known: boolean;
  version: number;
}

const expectedReconciliation = (model: Model, cycle: typeof Cycle.Type) => {
  const liveActive = model.active || cycle.cascade;
  const declarationChanged = model.version !== cycle.version;
  const wrote = declarationChanged && !cycle.staged;
  const unloaded = declarationChanged && cycle.staged && !cycle.reload;

  const coalesced =
    model.known &&
    cycle.known &&
    cycle.cascade &&
    !wrote &&
    !unloaded &&
    cycle.proved;

  const changed =
    !coalesced && (declarationChanged || model.inputs !== cycle.inputs);

  const expected: string[] = [];

  if (cycle.started && !liveActive) {
    expected.push("start");
  }

  if (cycle.started && liveActive && changed) {
    expected.push("restart");
  }

  if (!cycle.started && liveActive) {
    expected.push("stop");
  }

  return { expected, wrote };
};

it.effect.prop(
  "repeated reconciliation starts and stops to declaration, and coalesces only a proven loaded cascade",
  [Arbitrary.schema(Schema.Array(Cycle).check(Schema.isMaxLength(30)))],
  ([cycles]) =>
    Effect.gen(function* reconciliationModel() {
      const context = yield* Effect.context();
      const fake = yield* makeFakeShell();
      let invocation = 0;
      let known = true;

      const shell = {
        ...fake.shell,
        exec: (argv: readonly string[]) =>
          fake.shell.exec(argv).pipe(
            Effect.map((result) => {
              if (
                result.code === 0 &&
                (argv[2] === "start" || argv[2] === "restart")
              ) {
                invocation += 1;
              }

              return argv[2] === "show" && !argv.includes("--value")
                ? {
                    ...result,
                    stdout: `${result.stdout}InvocationID=${known ? `invocation-${invocation}` : ""}\n`,
                  }
                : result;
            })
          ),
      };

      const real = {
        output: yield* reconcileUnit(
          shell,
          props(0, 0, true),
          undefined,
          false
        ),
      };

      const commands: AsyncCommand<Model, typeof real>[] = cycles.map(
        (cycle) => ({
          check: () => true,
          run: (model, actual) =>
            Effect.runPromiseWith(context)(
              Effect.gen(function* step() {
                ({ known } = cycle);
                const next = props(cycle.version, cycle.inputs, cycle.started);

                if (cycle.staged) {
                  yield* stageOwnedUnit(shell, next, { attr: actual.output });

                  if (cycle.reload) {
                    yield* shell.exec(["systemctl", "--user", "daemon-reload"]);
                  }
                }

                if (cycle.cascade) {
                  yield* shell.exec([
                    "systemctl",
                    "--user",
                    "restart",
                    next.name,
                  ]);
                }

                const { expected, wrote } = expectedReconciliation(
                  model,
                  cycle
                );

                const before = (yield* fake.calls()).length;
                actual.output = yield* reconcileUnit(
                  shell,
                  next,
                  actual.output,
                  false,
                  Effect.succeed(cycle.proved)
                );
                const calls = (yield* fake.calls()).slice(before);
                expect(
                  calls
                    .filter(
                      (call) =>
                        call.operation === "exec" &&
                        ["start", "restart", "stop"].includes(
                          call.argv[2] ?? ""
                        )
                    )
                    .map((call) => call.argv[2])
                ).toEqual(expected);
                expect(
                  calls.filter((call) => call.operation === "write")
                ).toHaveLength(wrote ? 1 : 0);
                expect(actual.output.active).toBe(cycle.started);
                expect(actual.output.needDaemonReload).toBe(false);
                expect(actual.output.enabled).toBe(false);
                model.active = cycle.started;
                model.inputs = cycle.inputs;
                model.known = cycle.known;
                model.version = cycle.version;
              })
            ),
          toString: () => JSON.stringify(cycle),
        })
      );

      yield* Effect.promise(() =>
        fc.asyncModelRun(
          () => ({
            model: { active: true, inputs: 0, known: true, version: 0 },
            real,
          }),
          commands
        )
      );
    }),
  { arbitrary: { runs: 100, seed: 31_337 } }
);

const RetryVersion = Schema.Literals([1, 2, 3]);

it.effect(
  "a failed restart preserves the owned declaration for a successful retry",
  () =>
    Effect.gen(function* retryInvariant() {
      const context = yield* Effect.context();

      yield* Effect.promise(() =>
        fc.assert(
          fc.asyncProperty(
            fc.constantFrom(...RetryVersion.literals),
            (version) =>
              Effect.runPromiseWith(context)(
                Effect.gen(function* retry() {
                  const fake = yield* makeFakeShell();

                  const initial = yield* reconcileUnit(
                    fake.shell,
                    props(0, 0, true),
                    undefined,
                    false
                  );

                  yield* fake.failStart();
                  const next = props(version, version, true);

                  const failed = yield* reconcileUnit(
                    fake.shell,
                    next,
                    initial,
                    false
                  ).pipe(Effect.result);

                  expect(Result.isFailure(failed)).toBe(true);
                  const bytes = yield* fake.shell.read(initial.path);
                  expect(bytes).toBeDefined();

                  const retried = yield* reconcileUnit(
                    fake.shell,
                    next,
                    initial,
                    false
                  );

                  expect(retried.active).toBe(true);
                  expect(retried.needDaemonReload).toBe(false);
                  expect(retried.sha256).not.toBe(initial.sha256);
                })
              )
          ),
          { numRuns: 20, seed: 31_337 }
        )
      );
    })
);
