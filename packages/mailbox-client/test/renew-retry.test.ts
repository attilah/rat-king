import { it } from "@effect/vitest";
import * as Lease from "@rat-king/lexicon/runtime.lease";
import {
  Arbitrary,
  Clock,
  DateTime,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Result,
  Schema,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { consume } from "../src/consume.ts";
import { MailboxClientError } from "../src/error.ts";
import { RatKingMailbox } from "../src/mailbox.ts";

const lease = (time: number) =>
  Schema.decodeUnknownSync(Lease.Main)({
    did: "did:web:agent.example.invalid",
    expiresAt: DateTime.formatIso(DateTime.makeUnsafe(time + 10_000)),
    generation: 1,
    harness: { $type: "sh.mschf.ratking.runtime.lease#pi", sessionId: "test" },
    issuedAt: DateTime.formatIso(DateTime.makeUnsafe(time)),
    leaseId: "3mxcx45mn7sex",
  });

it.effect.prop(
  "transient renew failures retry within the live lease without releasing it",
  [
    Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 3, minimum: 1 }))
    ),
  ],
  ([failures]) =>
    Effect.gen(function* proof() {
      const acquired = yield* Deferred.make<boolean>();
      const renewed = yield* Deferred.make<boolean>();
      const current = lease(yield* Clock.currentTimeMillis);
      let attempts = 0;
      let releases = 0;

      const mailbox = yield* RatKingMailbox.pipe(
        Effect.provide(
          Layer.mock(RatKingMailbox, {
            lease: {
              acquire: () =>
                Deferred.succeed(acquired, true).pipe(Effect.as(current)),
              release: () =>
                Effect.sync(() => {
                  releases += 1;
                }),
              renew: () =>
                Effect.gen(function* renew() {
                  attempts += 1;

                  if (attempts <= failures) {
                    return yield* new MailboxClientError({
                      error: "MailboxUnavailable",
                      reason: "transient",
                      status: 503,
                    });
                  }

                  yield* Deferred.succeed(renewed, true);

                  return lease(yield* Clock.currentTimeMillis);
                }),
              resolve: () => Effect.succeed(current),
            },
            watch: () => Stream.never,
          })
        )
      );

      const fiber = yield* consume(mailbox, current.did, () => Effect.void, {
        harness: current.harness,
      }).pipe(Effect.forkScoped);

      yield* Deferred.await(acquired);
      yield* TestClock.adjust(5000 + failures * 1000);
      expect(attempts).toBe(failures + 1);
      yield* Deferred.await(renewed);
      expect(releases).toBe(0);
      yield* Fiber.interrupt(fiber);
      expect(releases).toBe(1);
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "renew retries require a full 3 s attempt and hung requests never run past expiresAt",
  [Arbitrary.schema(Schema.Boolean)],
  ([hang]) =>
    Effect.gen(function* proof() {
      const acquired = yield* Deferred.make<boolean>();
      const current = lease(yield* Clock.currentTimeMillis);
      const times: number[] = [];

      const mailbox = yield* RatKingMailbox.pipe(
        Effect.provide(
          Layer.mock(RatKingMailbox, {
            lease: {
              acquire: () =>
                Deferred.succeed(acquired, true).pipe(Effect.as(current)),
              release: () => Effect.void,
              renew: () =>
                Clock.currentTimeMillis.pipe(
                  Effect.tap((time) =>
                    Effect.sync(() => {
                      times.push(time);
                    })
                  ),
                  Effect.andThen(
                    hang
                      ? Effect.never
                      : Effect.fail(
                          new MailboxClientError({
                            reason: "unavailable",
                            status: 503,
                          })
                        )
                  )
                ),
              resolve: () => Effect.succeed(current),
            },
            watch: () => Stream.never,
          })
        )
      );

      const fiber = yield* consume(mailbox, current.did, () => Effect.void, {
        harness: current.harness,
      }).pipe(Effect.result, Effect.forkScoped);

      yield* Deferred.await(acquired);
      yield* TestClock.adjust(10_001);
      const result = yield* Fiber.join(fiber);

      expect(Result.isFailure(result)).toBe(true);
      expect(times.length).toBeGreaterThan(0);
      expect(
        times.every((time) => Date.parse(current.expiresAt) - time >= 3000)
      ).toBe(true);
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "failOnHeld never schedules an acquisition after the holder expires",
  [
    Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 30, minimum: 1 }))
    ),
  ],
  ([advance]) =>
    Effect.gen(function* proof() {
      let attempts = 0;
      const current = lease(yield* Clock.currentTimeMillis);

      const mailbox = yield* RatKingMailbox.pipe(
        Effect.provide(
          Layer.mock(RatKingMailbox, {
            lease: {
              acquire: () =>
                Effect.suspend(() => {
                  attempts += 1;

                  return Effect.fail(
                    new MailboxClientError({
                      error: "LeaseHeld",
                      reason: "parent is live",
                    })
                  );
                }),
              release: () => Effect.die("must not release parent's lease"),
              renew: () => Effect.die("must not renew parent's lease"),
              resolve: () => Effect.succeed(current),
            },
            watch: () => Stream.never,
          })
        )
      );

      const result = yield* consume(mailbox, current.did, () => Effect.void, {
        failOnHeld: true,
        harness: current.harness,
      }).pipe(Effect.result);

      yield* TestClock.adjust(advance * 60_000);
      expect(Result.isFailure(result)).toBe(true);
      expect(attempts).toBe(1);
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "a typed lease-expiry refusal remains expired even before the local deadline",
  [Schema.Int.check(Schema.isBetween({ maximum: 300_000, minimum: 2 }))],
  ([ttl]) =>
    Effect.gen(function* proof() {
      const acquired = yield* Deferred.make<boolean>();
      const base = yield* Clock.currentTimeMillis;

      const current = yield* Schema.decodeUnknownEffect(Lease.Main)({
        ...lease(base),
        expiresAt: DateTime.formatIso(DateTime.makeUnsafe(base + ttl)),
      });

      const mailbox = yield* RatKingMailbox.pipe(
        Effect.provide(
          Layer.mock(RatKingMailbox, {
            lease: {
              acquire: () =>
                Deferred.succeed(acquired, true).pipe(Effect.as(current)),
              release: () => Effect.void,
              renew: () =>
                Effect.fail(
                  new MailboxClientError({
                    error: "LeaseExpired",
                    reason: "Renewal exceeded lease expiry",
                  })
                ),
              resolve: () => Effect.succeed(current),
            },
            watch: () => Stream.never,
          })
        )
      );

      const fiber = yield* consume(mailbox, current.did, () => Effect.void, {
        harness: current.harness,
      }).pipe(Effect.result, Effect.forkScoped);

      yield* Deferred.await(acquired);
      yield* TestClock.adjust(Math.ceil(ttl / 2));
      const result = yield* Fiber.join(fiber);

      expect(yield* Clock.currentTimeMillis).toBeLessThan(
        Date.parse(current.expiresAt)
      );
      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure.error).toBe("LeaseExpired");
      }
    }).pipe(Effect.scoped)
);
