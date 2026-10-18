import { Failure } from "@rat-king/remembers";
import type { Job, RunBooksValue } from "@rat-king/remembers";
import { Clock, Effect, Schedule } from "effect";
import { createActor, setup } from "xstate";

export interface Admission {
  readonly load: number;
  readonly now: number;
  readonly threshold: number;
}

const machine = setup({}).createMachine({
  context: ({ input }: { input: Admission }) => input,
  initial: "checking",
  states: {
    checking: {
      always: ({ context }) => {
        const minute = Math.floor(context.now / 60_000) % 1440;

        if (minute >= 590 && minute < 640) {
          return { target: "window" };
        }

        return {
          target:
            !Number.isFinite(context.load) || context.load >= context.threshold
              ? "load"
              : "ready",
        };
      },
    },
    load: { type: "final" },
    ready: { type: "final" },
    window: { type: "final" },
  },
});

export const admission = (input: Admission) => {
  const actor = createActor(machine, { input });
  actor.start();
  const state = actor.getSnapshot().value;
  actor.stop();

  return state;
};

export interface AdmissionPorts {
  readonly load: () => Job<number>;
  readonly observe?: (
    state: ReturnType<typeof admission>
  ) => Effect.Effect<void>;
  readonly threshold: number;
}

export interface SchedulerPorts extends AdmissionPorts {
  readonly audit: () => Job<void>;
  readonly completed: (day: number) => Job<RunBooksValue | null>;
  readonly run: (day: number) => Job<RunBooksValue>;
}

export const awaitAdmission = Effect.fn("RemembersHost.admission")(
  function* awaitAdmission(ports: AdmissionPorts) {
    if (!Number.isFinite(ports.threshold) || ports.threshold <= 0) {
      return yield* new Failure({ code: "threshold", operation: "scheduler" });
    }

    return yield* Effect.gen(function* check() {
      const state = admission({
        load: yield* ports.load(),
        now: yield* Clock.currentTimeMillis,
        threshold: ports.threshold,
      });

      if (ports.observe !== undefined) {
        yield* ports.observe(state);
      }

      return state;
    }).pipe(
      Effect.repeat({
        schedule: Schedule.spaced("1 minute"),
        until: (state) => state === "ready",
      }),
      Effect.asVoid
    );
  }
);

export const dayMillis = 86_400_000;

export const catchUp = Effect.fn("RemembersHost.catchUp")(function* catchUp(
  from: number,
  through: number,
  ports: SchedulerPorts
) {
  yield* ports.audit();

  if (
    !Number.isSafeInteger(from / dayMillis) ||
    !Number.isSafeInteger(through / dayMillis) ||
    from < 0 ||
    through < from ||
    through - from > 365 * dayMillis
  ) {
    return yield* new Failure({ code: "day_range", operation: "catchUp" });
  }

  const proofs: RunBooksValue[] = [];

  for (let day = from; day <= through; day += dayMillis) {
    const done = yield* ports.completed(day);

    if (done !== null) {
      proofs.push(done);
      continue;
    }

    yield* awaitAdmission(ports);
    proofs.push(yield* ports.run(day));
  }

  return proofs;
});

export const nightly = Effect.fn("RemembersHost.nightly")(function* nightly(
  ports: SchedulerPorts
) {
  yield* ports.audit();
  yield* Effect.gen(function* pass() {
    const now = yield* Clock.currentTimeMillis;
    const day = Math.floor(now / dayMillis) * dayMillis - dayMillis;

    if ((yield* ports.completed(day)) === null) {
      yield* awaitAdmission(ports);
      yield* ports.run(day);
    }
  }).pipe(Effect.repeat(Schedule.spaced("5 minutes")));
});
