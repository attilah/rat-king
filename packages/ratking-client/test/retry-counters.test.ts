/* oxlint-disable typescript/promise-function-async -- fast-check commands are Promise boundaries around pure transitions. */
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { asyncModelRun } from "fast-check";
import { expect } from "vitest";

import {
  RetryEvent,
  retryFailure,
} from "../../mailbox-client/src/retry-metrics.ts";
import {
  countRetry,
  emptyRetries,
  RETRY_WINDOWS,
  RetrySnapshot,
} from "../src/retry-counters.ts";

const Step = Schema.Struct({
  advance: Schema.Int.check(Schema.isBetween({ maximum: 120_000, minimum: 0 })),
  event: RetryEvent,
  name: Schema.Literals(["reader-one", "reader-two"]),
});

it.effect.prop(
  "counts grow within a window; boundaries and eviction conserve every event",
  [Schema.Array(Step).check(Schema.isMinLength(80), Schema.isMaxLength(120))],
  ([steps]) =>
    Effect.promise(() =>
      asyncModelRun(
        () => ({
          model: { now: 0, total: 0 },
          real: { snapshot: emptyRetries() },
        }),
        steps.map((step) => ({
          check: () => true,
          run: (
            model: { now: number; total: number },
            real: { snapshot: RetrySnapshot }
          ) => {
            model.now += step.advance;
            model.total += 1;
            const before = real.snapshot;

            const snapshot = countRetry(
              before,
              step.name,
              step.event,
              model.now
            );

            real.snapshot = snapshot;

            expect(Schema.is(RetrySnapshot)(snapshot)).toBe(true);
            expect(snapshot.buckets.length).toBeLessThanOrEqual(RETRY_WINDOWS);
            expect(
              snapshot.evictedEvents +
                snapshot.buckets.reduce(
                  (sum, bucket) =>
                    sum +
                    Object.values(bucket.counts).reduce((a, b) => a + b, 0),
                  0
                )
            ).toBe(model.total);

            const start = Math.floor(model.now / 60_000) * 60_000;

            const oldCount =
              before.buckets.find(
                (bucket) => bucket.start === start && bucket.name === step.name
              )?.counts[step.event] ?? 0;

            expect(
              snapshot.buckets.find(
                (bucket) => bucket.start === start && bucket.name === step.name
              )?.counts[step.event]
            ).toBe(oldCount + 1);

            for (const old of before.buckets) {
              const retained = snapshot.buckets.find(
                (bucket) =>
                  bucket.name === old.name && bucket.start === old.start
              );

              if (retained !== undefined) {
                for (const event of RetryEvent.literals) {
                  expect(retained.counts[event]).toBeGreaterThanOrEqual(
                    old.counts[event]
                  );
                }
              }
            }

            return Promise.resolve();
          },
          toString: () => `${step.name}:${step.event}+${step.advance}`,
        }))
      )
    ),
  { arbitrary: { runs: 100 } }
);

it.prop(
  "error text never becomes a counter key",
  [Schema.String],
  ([reason]) => {
    expect(retryFailure("acquire", { error: "LeaseHeld", reason })).toBe(
      "acquireLeaseHeld"
    );
    expect(retryFailure("renew", { error: "Unrecognised", reason })).toBe(
      "renewOther"
    );
  }
);
