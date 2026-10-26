import { it } from "@effect/vitest";
import * as Lease from "@rat-king/lexicon/runtime.lease";
import {
  Clock,
  DateTime,
  Effect,
  Layer,
  Match,
  Random,
  Schema,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { consume } from "../src/consume.ts";
import { MailboxClientError } from "../src/error.ts";
import { RatKingMailbox } from "../src/mailbox.ts";
import type { RetryEvent } from "../src/retry-metrics.ts";

it.effect.prop(
  "timed-out renewals retry immediately; other renewals and held acquisitions spread within their remaining window",
  [
    Schema.String,
    Schema.Literals(["held", "renew", "timeout"]),
    Schema.Int.check(Schema.isBetween({ maximum: 1000, minimum: 16 })),
  ],
  ([seed, mode, headroom]) =>
    Effect.gen(function* proof() {
      const base = yield* Clock.currentTimeMillis;
      const retries: number[] = [];
      const metrics: RetryEvent[] = [];

      const floor = Match.value(mode).pipe(
        Match.when("held", () => 1000),
        Match.when("timeout", () => 8000),
        Match.orElse(() => 6000 - headroom)
      );

      const window = mode === "held" ? 2000 : headroom;

      yield* Effect.forEach(
        Array.from({ length: 64 }),
        () =>
          Effect.gen(function* reader() {
            let attempts = 0;

            const harness = {
              $type: "sh.mschf.ratking.runtime.lease#pi" as const,
              sessionId: "test",
            };

            const lease = (expiresAt: number) =>
              Schema.decodeUnknownSync(Lease.Main)({
                did: "did:web:agent.example.invalid",
                expiresAt: DateTime.formatIso(DateTime.makeUnsafe(expiresAt)),
                generation: 1,
                harness,
                leaseId: "3mxcx45mn7sex",
              });

            const attempt = Effect.gen(function* attempt() {
              attempts += 1;
              const now = yield* Clock.currentTimeMillis;

              if (attempts === 1) {
                if (mode === "timeout") {
                  return yield* Effect.never;
                }

                if (mode === "renew") {
                  yield* Effect.sleep(3000 - headroom);
                }

                return yield* new MailboxClientError({
                  error: mode === "held" ? "LeaseHeld" : "MailboxUnavailable",
                  reason: "simulated outage",
                });
              }

              if (attempts === 2) {
                retries.push(now - base - floor);
              }

              return lease(now + 10_000);
            });

            const mailbox = yield* RatKingMailbox.pipe(
              Effect.provide(
                Layer.mock(RatKingMailbox, {
                  lease: {
                    acquire: () =>
                      mode === "held"
                        ? attempt
                        : Effect.succeed(
                            lease(base + (mode === "renew" ? 6000 : 10_000))
                          ),
                    release: () => Effect.void,
                    renew: () => (mode === "held" ? Effect.never : attempt),
                    resolve: () => Effect.succeed(lease(base + 1000)),
                  },
                  watch: () => Stream.never,
                })
              )
            );

            yield* consume(
              mailbox,
              "did:web:agent.example.invalid",
              () => Effect.void,
              {
                harness,
                onRetryMetric: (event) =>
                  Effect.sync(() => {
                    metrics.push(event);
                  }),
              }
            ).pipe(Effect.forkScoped);
          }),
        { discard: true }
      );

      yield* TestClock.adjust(floor + window);
      expect(retries).toHaveLength(64);
      expect(metrics.filter((event) => event === "acquireOk")).toHaveLength(64);

      const failure = Match.value(mode).pipe(
        Match.when("held", () => "acquireLeaseHeld"),
        Match.when("timeout", () => "renewTimeout"),
        Match.orElse(() => "renewMailboxUnavailable")
      );

      expect(metrics.filter((event) => event === failure)).toHaveLength(64);

      if (mode === "timeout") {
        expect(retries.every((delay) => delay === 0)).toBe(true);
      } else {
        const minimum = mode === "renew" ? 1 : 0;

        expect(
          retries.every((delay) => delay >= minimum && delay <= window)
        ).toBe(true);
        expect(Math.min(...retries)).toBeLessThan(window * 0.25);
        expect(Math.max(...retries)).toBeGreaterThan(window * 0.75);
      }
    }).pipe(Random.withSeed(seed), Effect.scoped)
);
