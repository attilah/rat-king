import { Effect, Function as Fn, Ref } from "effect";
import { asyncModelRun } from "fast-check";
import type { AsyncCommand } from "fast-check";
import { expect } from "vitest";

import { NonceBinding, RunBinding } from "../../lexicon/pass-bindings.ts";
import type { TrustFailure } from "../../lexicon/trust-failure.ts";

export interface RunAction {
  readonly kind: "open" | "close" | "claim" | "expire" | "renew";
  readonly run: number;
  readonly worker: number;
}

interface RunModel {
  now: number;
  states: Map<
    number,
    { state: "open" | "bound" | "closed" | "compromised"; worker: number }
  >;
}

const tokenHash = "a".repeat(64);

const expectedRun = (model: RunModel, action: RunAction) => {
  const current = model.states.get(action.run);

  if (action.kind === "expire") {
    model.now += 301;

    return "void";
  }

  if (action.kind === "close") {
    model.states.set(action.run, { state: "closed", worker: -1 });

    return "void";
  }

  if (action.kind === "open") {
    if (current !== undefined || model.now >= 300) {
      return "refused";
    }

    model.states.set(action.run, { state: "open", worker: -1 });

    return "void";
  }

  if (action.kind === "renew") {
    return current?.state === "bound" && current.worker === action.worker
      ? "match"
      : "refused";
  }

  if (
    current === undefined ||
    current.state === "closed" ||
    current.state === "compromised"
  ) {
    return "refused";
  }

  if (current.state === "bound") {
    if (current.worker === action.worker) {
      return "match";
    }

    model.states.set(action.run, { state: "compromised", worker: -1 });

    return "compromised";
  }

  if (model.now >= 300) {
    return "refused";
  }

  model.states.set(action.run, { state: "bound", worker: action.worker });

  return "bound";
};

const observe = <A>(effect: Effect.Effect<A, TrustFailure>) =>
  effect.pipe(
    Effect.match({
      onFailure: (error) => {
        expect(error.reason.split(";")).toHaveLength(3);

        return "refused";
      },
      onSuccess: (value) => value ?? "void",
    })
  );

const actualRun = (
  service: typeof RunBinding.Service,
  action: RunAction,
  workers: readonly string[],
  now: number
) => {
  const run = `run-${action.run}`;

  if (action.kind === "open") {
    return observe(service.open(run, { exp: 300, iat: 0, tokenHash }, now));
  }

  if (action.kind === "close") {
    return observe(service.close(run));
  }

  if (action.kind === "expire") {
    return Effect.succeed("void");
  }

  if (action.kind === "renew") {
    return observe(service.renew(run, workers[action.worker] ?? "", now));
  }

  return observe(
    service.claim(run, tokenHash, workers[action.worker] ?? "", now)
  );
};

export const runModel = Effect.fn("Test.runModel")(function* runModel(
  actions: readonly RunAction[],
  workers: readonly string[]
) {
  const service = yield* RunBinding;
  const context = yield* Effect.context();

  const required: readonly RunAction[] = [
    { kind: "claim", run: 0, worker: 0 },
    { kind: "open", run: 0, worker: 0 },
    { kind: "claim", run: 0, worker: 0 },
    { kind: "claim", run: 0, worker: 0 },
    { kind: "claim", run: 0, worker: 1 },
    { kind: "claim", run: 0, worker: 0 },
    { kind: "claim", run: 0, worker: 1 },
    { kind: "open", run: 1, worker: 0 },
    { kind: "open", run: 2, worker: 0 },
    { kind: "close", run: 2, worker: 0 },
    { kind: "claim", run: 2, worker: 0 },
    { kind: "renew", run: 2, worker: 0 },
    { kind: "open", run: 3, worker: 0 },
    { kind: "renew", run: 3, worker: 0 },
    { kind: "claim", run: 3, worker: 0 },
    { kind: "renew", run: 3, worker: 1 },
    { kind: "renew", run: 3, worker: 0 },
    { kind: "claim", run: 3, worker: 0 },
    { kind: "renew", run: 0, worker: 0 },
    { kind: "expire", run: 1, worker: 0 },
    { kind: "claim", run: 1, worker: 0 },
    { kind: "renew", run: 3, worker: 0 },
    { kind: "close", run: 3, worker: 0 },
    { kind: "renew", run: 3, worker: 0 },
  ];

  const commands: readonly AsyncCommand<RunModel, typeof service>[] = [
    ...required,
    ...actions,
  ].map((action) => ({
    check: () => true,
    run: Fn.flow(
      (model: RunModel, real: typeof service) =>
        Effect.gen(function* runCommand() {
          const { now } = model;
          const expected = expectedRun(model, action);
          expect(yield* actualRun(real, action, workers, now)).toBe(expected);
        }),
      Effect.runPromiseWith(context)
    ),
    toString: () => JSON.stringify(action),
  }));

  const setup = () => ({ model: { now: 0, states: new Map() }, real: service });
  yield* Effect.promise(asyncModelRun.bind(null, setup, commands));
});

export interface NonceAction {
  readonly advance: boolean;
  readonly run: number;
  readonly worker: number;
}

interface NonceModel {
  binding: { run: number; until: number; worker: number } | undefined;
  now: number;
}

export const nonceModel = Effect.fn("Test.nonceModel")(function* nonceModel(
  actions: readonly NonceAction[],
  clock: Ref.Ref<number>
) {
  const model: NonceModel = { binding: undefined, now: 0 };
  const service = yield* NonceBinding;
  const context = yield* Effect.context();

  const commands: readonly AsyncCommand<NonceModel, typeof service>[] =
    actions.map((action) => ({
      check: () => true,
      run: Fn.flow(
        (state: NonceModel, real: typeof service) =>
          Effect.gen(function* nonceCommand() {
            if (action.advance) {
              state.now += 101;
            }

            const active =
              state.binding !== undefined && state.binding.until >= state.now;

            const conflict =
              active &&
              (state.binding?.run !== action.run ||
                state.binding.worker !== action.worker);

            let expected = active ? "match" : "new";

            if (conflict) {
              expected = "conflict";
            }

            const until = state.now + 100;

            yield* Ref.set(clock, state.now);

            const result = yield* real.bind(
              "desk",
              "nonce",
              {
                run: `run-${action.run}`,
                workerThumbprint: `key-${action.worker}`,
              },
              until
            );

            expect(result).toBe(expected);

            if (!conflict) {
              state.binding = { run: action.run, until, worker: action.worker };
            }
          }),
        Effect.runPromiseWith(context)
      ),
      toString: () => JSON.stringify(action),
    }));

  const setup = () => ({ model, real: service });
  yield* Effect.promise(asyncModelRun.bind(null, setup, commands));
});
