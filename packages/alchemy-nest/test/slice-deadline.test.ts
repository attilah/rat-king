import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Clock, Effect, Fiber, Ref, Schema, Stream } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { expect } from "vitest";

import { executeCountProcess } from "../src/slice-count.ts";

const slowQuery = `
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
process.stderr.write('SLOW_QUERY_READY');
db.prepare('WITH RECURSIVE n(x) AS (SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x<400000000) SELECT sum(x) FROM n').get();
`;

const input = {
  literal: "invented literal",
  path: "/srv/example/unused.db",
  role: null,
  since: 0,
};

const absentProcess = Schema.is(
  Schema.Struct({ code: Schema.Literal("ESRCH") })
);

const isAbsent = (pid: number) =>
  Effect.sync(() => {
    try {
      process.kill(pid, 0);

      return false;
    } catch (error) {
      return absentProcess(error);
    }
  });

const observe = Effect.fn("Test.count.observe")(function* observe() {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const pid = yield* Ref.make(0);
  const scanning = yield* Ref.make(false);

  yield* Effect.addFinalizer(() =>
    Ref.get(pid).pipe(
      Effect.flatMap((found) =>
        Effect.try(() => process.kill(found, "SIGKILL")).pipe(
          Effect.when(Effect.succeed(found > 0)),
          Effect.ignore
        )
      )
    )
  );

  const observed = ChildProcessSpawner.ChildProcessSpawner.of({
    ...spawner,
    spawn: Effect.fn("Test.count.spawn")(function* spawn(command) {
      const handle = yield* spawner.spawn(command);
      yield* Ref.set(pid, Number(handle.pid));

      return {
        ...handle,
        stderr: handle.stderr.pipe(
          Stream.tap((part) =>
            Buffer.from(part).toString("utf-8").includes("SLOW_QUERY_READY")
              ? Ref.set(scanning, true)
              : Effect.void
          )
        ),
      };
    }),
  });

  return { observed, pid, scanning };
});

it.live(
  "count deadline SIGKILLs an actual SQLite scan and reaps its OS process",
  () =>
    Effect.gen(function* deadline() {
      const { observed, pid, scanning } = yield* observe();

      const started = yield* Clock.currentTimeMillis;

      const failure = yield* Effect.flip(
        executeCountProcess(slowQuery, input).pipe(
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            observed
          )
        )
      );

      const elapsed = (yield* Clock.currentTimeMillis) - started;
      const childPid = yield* Ref.get(pid);
      expect(failure.status).toBe(408);
      expect(yield* Ref.get(scanning)).toBe(true);
      expect(childPid).toBeGreaterThan(0);
      expect(elapsed).toBeGreaterThanOrEqual(9900);
      expect(elapsed).toBeLessThan(13_000);
      expect(yield* isAbsent(childPid)).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

it.live("interrupting the count fiber SIGKILLs the running SQLite scan", () =>
  Effect.gen(function* interrupted() {
    const { observed, pid, scanning } = yield* observe();

    const fiber = yield* Effect.forkChild(
      executeCountProcess(slowQuery, input).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, observed)
      )
    );

    yield* Effect.gen(function* ready() {
      while (!(yield* Ref.get(scanning))) {
        yield* Effect.sleep("50 millis");
      }
    }).pipe(Effect.timeout("8 seconds"));

    const childPid = yield* Ref.get(pid);
    expect(childPid).toBeGreaterThan(0);
    expect(yield* isAbsent(childPid)).toBe(false);

    yield* Fiber.interrupt(fiber);

    expect(yield* isAbsent(childPid)).toBe(true);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
