import { it } from "@effect/vitest";
import { Effect, Random, Schema } from "effect";
import { expect } from "vitest";

import {
  readerRetryDelay,
  successionRetryDelay,
} from "../src/lease-recovery.ts";

it.effect.prop(
  "reader supervision spreads first retries and retains its five-second ceiling",
  [
    Schema.String,
    Schema.Int.check(Schema.isBetween({ maximum: 100, minimum: 1 })),
    Schema.Boolean,
  ],
  ([seed, attempt, successor]) =>
    Effect.gen(function* proof() {
      const window = successor
        ? 5000
        : Math.min(5000, 1000 * 2 ** Math.min(attempt, 5));

      const delays = yield* Effect.forEach(Array.from({ length: 64 }), () =>
        successor ? successionRetryDelay : readerRetryDelay(attempt)
      );

      expect(delays.every((delay) => delay >= 0 && delay < window)).toBe(true);
      expect(Math.min(...delays)).toBeLessThan(window * 0.25);
      expect(Math.max(...delays)).toBeGreaterThan(window * 0.75);
    }).pipe(Random.withSeed(seed))
);
