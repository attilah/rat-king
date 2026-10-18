import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { testLayer } from "../adapters/testing.ts";
import { Failure, PlanSteps } from "../src/contract.ts";
import { runNight } from "../src/night.ts";
import { retryModel } from "../src/pipeline.ts";
import { draft, fixture, slice } from "./fixtures.ts";

it.effect.prop(
  "model retry backs off on quota and overload but fails non-transient errors",
  [Schema.Literals(["429", "503", "server_is_overloaded", "forbidden"])],
  ([code]) =>
    Effect.gen(function* retryProof() {
      let attempts = 0;

      const job = Effect.suspend(() => {
        attempts += 1;

        return attempts === 1
          ? Effect.fail(new Failure({ code, operation: "fixture" }))
          : Effect.succeed("recovered");
      });

      const fiber = yield* retryModel(job).pipe(Effect.exit, Effect.forkScoped);
      yield* TestClock.adjust("10 seconds");
      const exit = yield* Fiber.join(fiber);
      expect(exit._tag).toBe(code === "forbidden" ? "Failure" : "Success");
      expect(attempts).toBe(code === "forbidden" ? 1 : 2);
    })
);

it.effect.prop(
  "night bounds combined observer and judge concurrency, defaults to sixteen, and permits configured fan-out",
  [Schema.Boolean],
  ([useDefault]) => {
    const cap = useDefault ? 16 : 3;

    const slices = Array.from({ length: cap + 2 }, (_unused, index) =>
      slice(`conversation-${index}`)
    );

    const data = {
      ...fixture(1),
      drafts: new Map(
        slices.map((item) => [
          item.key.conversation,
          [draft(item.key.conversation, 1)],
        ])
      ),
      slices,
    };

    return Effect.gen(function* concurrencyProof() {
      const original = yield* PlanSteps;
      const active = yield* Ref.make(0);
      const maximum = yield* Ref.make(0);
      const full = yield* Deferred.make<true>();
      const release = yield* Deferred.make<true>();

      const steps = PlanSteps.of({
        ...original,
        think: (identity, key) =>
          Effect.acquireUseRelease(
            Effect.gen(function* enter() {
              const count = yield* Ref.updateAndGet(
                active,
                (current) => current + 1
              );

              yield* Ref.update(maximum, (value) => Math.max(value, count));

              if (count === cap) {
                yield* Deferred.succeed(full, true);
              }
            }),
            () =>
              Deferred.await(release).pipe(
                Effect.andThen(original.think(identity, key))
              ),
            () => Ref.update(active, (current) => current - 1)
          ),
      });

      const config = {
        at: data.at,
        owner: "orchid-desk",
        runId: "concurrency",
      };

      const task = useDefault
        ? runNight(config)
        : runNight({ ...config, concurrency: cap });

      const fiber = yield* task.pipe(
        Effect.provideService(PlanSteps, steps),
        Effect.forkScoped
      );

      yield* Deferred.await(full);
      expect(yield* Ref.get(maximum)).toBe(cap);
      yield* Deferred.succeed(release, true);
      const books = yield* Fiber.join(fiber);
      expect(books.slices_read).toBe(cap + 2);
      expect(yield* Ref.get(active)).toBe(0);
    }).pipe(Effect.provide(testLayer(data)));
  }
);
