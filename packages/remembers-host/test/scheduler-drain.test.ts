import { it } from "@effect/vitest";
import { Store, emptyBooks } from "@rat-king/remembers";
import { nodeCells } from "@rat-king/remembers/node-sqlite";
import { sqliteStore } from "@rat-king/remembers/sqlite";
import { Deferred, Effect, Fiber, Layer, Queue } from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { awaitAdmission } from "../src/scheduler.ts";

it.effect(
  "crossing 09:50 drains an in-flight call and stores its safe result, but holds the next branch until 10:40",
  () =>
    Effect.gen(function* drain() {
      const store = yield* Store;
      yield* store.start("inflight");
      yield* TestClock.setTime(589 * 60_000);
      const calls = yield* Queue.unbounded<string>();
      const finish = yield* Deferred.make<boolean>();
      const ports = { load: () => Effect.succeed(0), threshold: 40 };

      const first = yield* Effect.gen(function* firstCall() {
        yield* awaitAdmission(ports);
        yield* Queue.offer(calls, "first");
        yield* Deferred.await(finish);
        yield* store.finish("inflight", "safe-cursor", emptyBooks());
      }).pipe(Effect.forkScoped);

      expect(yield* Queue.take(calls)).toBe("first");
      yield* TestClock.adjust("1 minute");

      const second = yield* awaitAdmission(ports).pipe(
        Effect.andThen(Queue.offer(calls, "second")),
        Effect.forkScoped
      );

      yield* Deferred.succeed(finish, true);
      yield* Fiber.join(first);
      expect(yield* store.cursor()).toBe("safe-cursor");
      expect(yield* Queue.size(calls)).toBe(0);
      yield* TestClock.adjust("50 minutes");
      yield* Fiber.join(second);
      expect(yield* Queue.take(calls)).toBe("second");
    }).pipe(
      Effect.provide(
        sqliteStore.pipe(
          Layer.provide(
            nodeCells(":memory:", new Map([["orchid", ":memory:"]]))
          )
        )
      ),
      Effect.scoped
    )
);
