import { it } from "@effect/vitest";
import { Failure, Store } from "@rat-king/remembers";
import { auditOwed } from "@rat-king/remembers/night";
import { nodeCells } from "@rat-king/remembers/node-sqlite";
import { sqliteStore } from "@rat-king/remembers/sqlite";
import {
  Arbitrary,
  Effect,
  Exit,
  Fiber,
  Layer,
  Queue,
  Ref,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { NoticeTransport, durableSpeaks } from "../src/notices.ts";
import { admission, awaitAdmission } from "../src/scheduler.ts";

it.effect.prop(
  "the admission machine excludes every minute in the protected window and pauses at the configured load threshold",
  {
    load: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 80, minimum: 0 }))
    ),
    minute: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 1439, minimum: 0 }))
    ),
  },
  ({ load, minute }) =>
    Effect.sync(() => {
      const state = admission({ load, now: minute * 60_000, threshold: 40 });
      let expected = load >= 40 ? "load" : "ready";

      if (minute >= 590 && minute < 640) {
        expected = "window";
      }

      expect(state).toBe(expected);
    })
);

it.effect(
  "test-clock admission waits through the window and then through high load",
  () =>
    Effect.gen(function* clock() {
      yield* TestClock.setTime(590 * 60_000);
      const load = yield* Ref.make(50);
      const reads = yield* Queue.unbounded<number>();
      const done = yield* Ref.make(false);

      const task = yield* awaitAdmission({
        load: () =>
          Ref.get(load).pipe(Effect.tap((value) => Queue.offer(reads, value))),
        threshold: 40,
      }).pipe(
        Effect.tap(() => Ref.set(done, true)),
        Effect.forkScoped
      );

      expect(yield* Queue.take(reads)).toBe(50);
      yield* TestClock.adjust("50 minutes");
      expect(yield* Ref.get(done)).toBe(false);
      yield* Ref.set(load, 0);
      yield* TestClock.adjust("1 minute");
      yield* Fiber.join(task);
      expect(yield* Ref.get(done)).toBe(true);
    }).pipe(Effect.scoped)
);

it.effect(
  "recovery audits report debt and retries the exact persisted envelope after a crash without sending a second notice",
  () =>
    Effect.gen(function* recovery() {
      const store = yield* Store;
      yield* store.start("interrupted");
      let prepared = 0;
      const attempts: string[] = [];
      const delivered = new Set<string>();

      const transport = Layer.succeed(
        NoticeTransport,
        NoticeTransport.of({
          prepare: (notice) =>
            Effect.sync(() => {
              prepared += 1;

              return `${notice.id}:${prepared}`;
            }),
          send: (wire) =>
            Effect.suspend(() => {
              attempts.push(wire);
              delivered.add(wire);

              return attempts.length === 1
                ? Effect.fail(
                    new Failure({ code: "lost_ack", operation: "test" })
                  )
                : Effect.void;
            }),
        })
      );

      const speaks = durableSpeaks.pipe(Layer.provide(transport));

      const crashed = yield* Effect.exit(
        auditOwed("fixture").pipe(Effect.provide(Layer.fresh(speaks)))
      );

      expect(Exit.isFailure(crashed)).toBe(true);
      yield* auditOwed("fixture").pipe(Effect.provide(Layer.fresh(speaks)));
      yield* auditOwed("fixture").pipe(Effect.provide(Layer.fresh(speaks)));
      expect(attempts).toEqual(["alarm:interrupted:1", "alarm:interrupted:1"]);
      expect(prepared).toBe(1);
      expect(delivered.size).toBe(1);
    }).pipe(
      Effect.provide(
        sqliteStore.pipe(
          Layer.provideMerge(
            nodeCells(":memory:", new Map([["orchid", ":memory:"]]))
          )
        )
      ),
      Effect.scoped
    )
);
