import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { SliceSource } from "../src/slice-source.ts";
import { sqliteSliceSource } from "../src/slice-sqlite.ts";
import { fixtureNow, makeSliceFixture } from "./slice-fixtures.ts";

it.effect("a second count returns 429 before allocating a process", () =>
  Effect.gen(function* concurrency() {
    const path = yield* makeSliceFixture("invented fixture");
    yield* TestClock.setTime(fixtureNow);
    const started = yield* Deferred.make<boolean>();
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    let spawned = 0;

    const blocked = ChildProcessSpawner.ChildProcessSpawner.of({
      ...spawner,
      spawn: Effect.fn("Test.count.blockedSpawn")(function* spawn() {
        spawned += 1;
        yield* Deferred.succeed(started, true);

        return yield* Effect.never;
      }),
    });

    yield* Effect.gen(function* checks() {
      const source = yield* SliceSource;

      const signature = {
        literal: "invented literal",
        since_ms: fixtureNow - 86_400_000,
      };

      const first = yield* source.count(signature).pipe(Effect.forkScoped);
      yield* Deferred.await(started);
      const busy = yield* Effect.flip(source.count(signature));
      expect(busy.status).toBe(429);
      expect(spawned).toBe(1);
      yield* Fiber.interrupt(first);
    }).pipe(
      Effect.provide(sqliteSliceSource(path, 30)),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, blocked)
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
