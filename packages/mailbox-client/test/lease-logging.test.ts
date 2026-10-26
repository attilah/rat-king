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
  Logger,
  Result,
  Schema,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { consume } from "../src/consume.ts";
import { MailboxClientError } from "../src/error.ts";
import { RatKingMailbox } from "../src/mailbox.ts";

it.effect.prop(
  "lease lifecycle logs carry the name, generation, expiry and reason on one line",
  [Arbitrary.schema(Schema.Literals(["renew", "loss", "lapse"]))],
  ([outcome]) => {
    const lines: string[] = [];

    const logger = Logger.layer([
      Logger.make(({ message }) => {
        lines.push(String(message));
      }),
    ]);

    return Effect.gen(function* proof() {
      const acquired = yield* Deferred.make<boolean>();
      const renewed = yield* Deferred.make<boolean>();
      const now = yield* Clock.currentTimeMillis;

      const lease = yield* Schema.decodeUnknownEffect(Lease.Main)({
        did: "did:web:agent.example.invalid",
        expiresAt: DateTime.formatIso(DateTime.makeUnsafe(now + 10_000)),
        generation: 1,
        harness: {
          $type: "sh.mschf.ratking.runtime.lease#pi",
          sessionId: "test",
        },
        issuedAt: DateTime.formatIso(DateTime.makeUnsafe(now)),
        leaseId: "3mxcx45mn7sex",
      });

      const mailbox = yield* RatKingMailbox.pipe(
        Effect.provide(
          Layer.mock(RatKingMailbox, {
            lease: {
              acquire: () =>
                Deferred.succeed(acquired, true).pipe(Effect.as(lease)),
              release: () => Effect.void,
              renew: () =>
                Effect.gen(function* renewLease() {
                  if (outcome === "lapse") {
                    return yield* Effect.never;
                  }

                  if (outcome !== "renew") {
                    return yield* new MailboxClientError({
                      error: "LeaseMismatch",
                      reason: "refused\nby authority",
                    });
                  }

                  return yield* Schema.decodeUnknownEffect(Lease.Main)({
                    ...lease,
                    expiresAt: DateTime.formatIso(
                      DateTime.makeUnsafe(now + 300_000)
                    ),
                  }).pipe(Effect.orDie);
                }),
              resolve: () => Effect.succeed(lease),
            },
            watch: () => Stream.never,
          })
        )
      );

      const fiber = yield* consume(mailbox, lease.did, () => Effect.void, {
        harness: lease.harness,
        leaseName: "agent",
        onLease: (held) =>
          held.expiresAt === lease.expiresAt
            ? Effect.void
            : Deferred.succeed(renewed, true).pipe(Effect.asVoid),
      }).pipe(Effect.result, Effect.forkScoped);

      yield* Deferred.await(acquired);
      yield* TestClock.adjust(outcome === "lapse" ? 10_001 : 5000);

      if (outcome === "renew") {
        yield* Deferred.await(renewed);
        yield* Fiber.interrupt(fiber);
      } else {
        expect(Result.isFailure(yield* Fiber.join(fiber))).toBe(true);
      }

      const events = lines.filter((line) => line.startsWith("lease "));

      for (const event of ["acquire", "renew-attempt", outcome, "release"]) {
        expect(events.some((line) => line.startsWith(`lease ${event} `))).toBe(
          true
        );
      }

      expect(
        events.every(
          (line) =>
            !line.includes("\n") &&
            / name=agent generation=(?:1|new) expiresAt=\S+ reason=/u.test(line)
        )
      ).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(logger));
  }
);
