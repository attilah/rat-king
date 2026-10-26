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

it.effect.prop(
  "held acquisition and failed or timed-out renewal spread first retries over the full window",
  [Schema.String, Schema.Literals(["held", "renew", "timeout"])],
  ([seed, mode]) =>
    Effect.gen(function* proof() {
      const base = yield* Clock.currentTimeMillis;
      const retries: number[] = [];

      const floor = Match.value(mode).pipe(
        Match.when("held", () => 1000),
        Match.when("timeout", () => 8000),
        Match.orElse(() => 5000)
      );

      const window = mode === "held" ? 2000 : 1000;

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
                        : Effect.succeed(lease(base + 10_000)),
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
              }
            ).pipe(Effect.forkScoped);
          }),
        { discard: true }
      );

      yield* TestClock.adjust(floor + window);
      expect(retries).toHaveLength(64);
      expect(retries.every((delay) => delay >= 0 && delay < window)).toBe(true);
      expect(Math.min(...retries)).toBeLessThan(window * 0.25);
      expect(Math.max(...retries)).toBeGreaterThan(window * 0.75);
    }).pipe(Random.withSeed(seed), Effect.scoped)
);
