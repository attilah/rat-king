import { it } from "@effect/vitest";
import * as Lease from "@rat-king/lexicon/runtime.lease";
import {
  Arbitrary,
  Clock,
  DateTime,
  Effect,
  Fiber,
  Layer,
  Result,
  Schedule,
  Schema,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { consume } from "../src/consume.ts";
import { MailboxClientError } from "../src/error.ts";
import { RatKingMailbox } from "../src/mailbox.ts";
import type { AcquireRequest } from "../src/mailbox.ts";

const did = "did:web:agent.example.invalid";

const harness: Lease.MainValue["harness"] = {
  $type: "sh.mschf.ratking.runtime.lease#pi",
  sessionId: "test",
};

interface Outage {
  readonly from: number;
  readonly until: number;
}

interface Server {
  acquires: number;
  generations: number[];
  holder: Lease.MainValue | undefined;
  releases: number;
  renews: number;
  renewTimes: number[];
}

const stamp = (time: number) => DateTime.formatIso(DateTime.makeUnsafe(time));

const issue = (
  generation: number,
  issuedAt: number,
  expiresAt: string,
  leaseId: string
) =>
  Schema.decodeUnknownSync(Lease.Main)({
    did,
    expiresAt,
    generation,
    harness,
    issuedAt: stamp(issuedAt),
    leaseId,
  });

const fake = (
  outage: Outage,
  stranger?: Lease.MainValue,
  hangRelease = false
) =>
  Effect.gen(function* fakeMailbox() {
    const base = yield* Clock.currentTimeMillis;

    const server: Server = {
      acquires: 0,
      generations: [],
      holder: stranger,
      releases: 0,
      renewTimes: [],
      renews: 0,
    };

    const down = Clock.currentTimeMillis.pipe(
      Effect.map(
        (time) => time >= base + outage.from && time < base + outage.until
      )
    );

    const gated = <A, E>(effect: Effect.Effect<A, E>) =>
      down.pipe(Effect.flatMap((isDown) => (isDown ? Effect.never : effect)));

    const live = (time: number) =>
      server.holder !== undefined && Date.parse(server.holder.expiresAt) > time;

    const mailbox = yield* RatKingMailbox.pipe(
      Effect.provide(
        Layer.mock(RatKingMailbox, {
          lease: {
            acquire: (input: AcquireRequest) =>
              gated(
                Effect.gen(function* acquire() {
                  const time = yield* Clock.currentTimeMillis;

                  if (live(time) && server.holder?.leaseId !== input.leaseId) {
                    return yield* new MailboxClientError({
                      error: "LeaseHeld",
                      reason: "held",
                    });
                  }

                  server.acquires += 1;
                  const generation = (server.holder?.generation ?? 0) + 1;
                  server.generations.push(generation);

                  server.holder = issue(
                    generation,
                    time,
                    input.expiresAt,
                    `3mxcx45mn7s${"abcdefghij"[generation % 10]}x`
                  );

                  return server.holder;
                })
              ),
            release: () =>
              hangRelease
                ? Effect.never
                : gated(
                    Effect.sync(() => {
                      server.releases += 1;
                      server.holder = undefined;
                    })
                  ),
            renew: (input) =>
              gated(
                Effect.gen(function* renew() {
                  const time = yield* Clock.currentTimeMillis;

                  if (
                    server.holder === undefined ||
                    server.holder.leaseId !== input.leaseId ||
                    !live(time)
                  ) {
                    return yield* new MailboxClientError({
                      error: "LeaseMismatch",
                      reason: "fence",
                    });
                  }

                  server.renews += 1;
                  server.renewTimes.push(time);

                  server.holder = issue(
                    server.holder.generation,
                    time,
                    input.expiresAt,
                    server.holder.leaseId
                  );

                  return server.holder;
                })
              ),
            resolve: () =>
              gated(
                server.holder === undefined
                  ? Effect.fail(
                      new MailboxClientError({
                        error: "LeaseNotFound",
                        reason: "none",
                      })
                    )
                  : Effect.succeed(server.holder)
              ),
          },
          watch: () => Stream.never,
        })
      )
    );

    return { base, mailbox, server };
  });

const run = (millis: number) =>
  Effect.forEach(
    Array.from({ length: Math.ceil(millis / 1000) }),
    () => TestClock.adjust(1000),
    { discard: true }
  );

it.effect(
  "an 8 s outage that swallows requests leaves the reader renewed within 30 s of recovery",
  () =>
    Effect.gen(function* proof() {
      const outage = { from: 149_000, until: 157_000 };
      const { base, mailbox, server } = yield* fake(outage);

      const fiber = yield* consume(mailbox, did, () => Effect.void, {
        harness,
      }).pipe(Effect.result, Effect.forkScoped);

      yield* run(outage.until + 30_000);
      const [renewedAt] = server.renewTimes;

      expect(renewedAt).toBeDefined();
      expect((renewedAt ?? 0) - base).toBeLessThanOrEqual(
        outage.until + 30_000
      );
      expect(server.acquires).toBe(1);
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* Fiber.interrupt(fiber);
    }).pipe(Effect.scoped)
);

it.effect(
  "a renew request that is never answered is retried before expiry",
  () =>
    Effect.gen(function* proof() {
      const outage = { from: 149_000, until: 150_500 };
      const { base, mailbox, server } = yield* fake(outage);

      const fiber = yield* consume(mailbox, did, () => Effect.void, {
        harness,
      }).pipe(Effect.result, Effect.forkScoped);

      yield* run(160_000);
      expect(server.renews).toBeGreaterThan(0);
      expect((server.renewTimes[0] ?? 0) - base).toBeLessThan(160_000);
      yield* Fiber.interrupt(fiber);
    }).pipe(Effect.scoped)
);

it.effect("a release that is never answered does not hold the reader", () =>
  Effect.gen(function* proof() {
    const { mailbox, server } = yield* fake(
      { from: 0, until: 0 },
      undefined,
      true
    );

    const fiber = yield* consume(mailbox, did, () => Effect.void, {
      harness,
    }).pipe(Effect.result, Effect.forkScoped);

    yield* run(1000);
    server.holder = undefined;
    yield* run(150_000);
    expect(fiber.pollUnsafe()).toBeUndefined();
    yield* run(10_000);
    expect(fiber.pollUnsafe()).toBeDefined();
  }).pipe(Effect.scoped)
);

it.effect("a lease held by another reader is never taken over", () =>
  Effect.gen(function* proof() {
    const now = yield* Clock.currentTimeMillis;

    const stranger = issue(7, now, stamp(now + 600_000), "3mxcx45mn7sez");

    const { mailbox, server } = yield* fake({ from: 0, until: 8000 }, stranger);

    const fiber = yield* consume(mailbox, did, () => Effect.void, {
      failOnHeld: true,
      harness,
    }).pipe(
      Effect.result,
      Effect.repeat({
        schedule: Schedule.spaced("1 second"),
        until: (result) =>
          !Result.isFailure(result) ||
          result.failure.error !== "MailboxUnavailable",
      }),
      Effect.forkScoped
    );

    yield* run(60_000);
    const result = yield* Fiber.join(fiber);
    expect(Result.isFailure(result) && result.failure.error).toBe("LeaseHeld");
    expect(server.acquires).toBe(0);
    expect(server.holder?.leaseId).toBe("3mxcx45mn7sez");
  }).pipe(Effect.scoped)
);

it.effect.prop(
  "after any outage the reader is consuming within 30 s and the generation never goes back",
  [
    Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 170_000, minimum: 0 }))
    ),
    Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 20_000, minimum: 0 }))
    ),
  ],
  ([from, length]) =>
    Effect.gen(function* proof() {
      const outage = { from, until: from + length };
      const { mailbox, server } = yield* fake(outage);
      const seen: number[] = [];

      const fiber = yield* consume(mailbox, did, () => Effect.void, {
        harness,
        onLease: (lease) =>
          Effect.sync(() => {
            seen.push(lease.generation);
          }),
      }).pipe(
        Effect.result,
        Effect.repeat({
          schedule: Schedule.spaced("5 seconds"),
          until: (result) =>
            !Result.isFailure(result) ||
            result.failure.error !== "MailboxUnavailable",
        }),
        Effect.forkScoped
      );

      yield* run(Math.max(outage.until + 30_000, 190_000));
      expect(fiber.pollUnsafe()).toBeUndefined();
      expect(server.renews).toBeGreaterThan(0);
      expect(seen.length).toBeGreaterThan(0);
      expect(
        seen.every((value, i) => i === 0 || value >= (seen[i - 1] ?? 0))
      ).toBe(true);
      expect(server.generations.every((value) => value === 1)).toBe(true);
      yield* Fiber.interrupt(fiber);
    }).pipe(Effect.scoped),
  { arbitrary: { runs: 10 } }
);
