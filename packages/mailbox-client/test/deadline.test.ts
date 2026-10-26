/* oxlint-disable typescript/promise-function-async, promise/avoid-new -- Fetch is the Promise boundary being tested, not an Effect implementation. */
// @effect-diagnostics newPromise:off -- Fake Fetch must expose a real cancellable Promise to the Effect HTTP adapter.
import { it } from "@effect/vitest";
import { Transport } from "@rat-king/lexicon/transport";
import type { TransportFailure } from "@rat-king/lexicon/transport-failure";
import type { Cause } from "effect";
import {
  Clock,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Schedule,
  Schema,
} from "effect";
import { FetchHttpClient, HttpClient, HttpClientError } from "effect/http";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import * as Deadline from "../src/deadline.ts";
import { transportLayer } from "../src/transport.ts";
import { identity } from "./identity.ts";

const request = {
  input: undefined,
  method: "GET" as const,
  nsid: "sh.mschf.ratking.runtime.resolveLease",
  params: undefined,
};

const small = Schema.Int.check(Schema.isBetween({ maximum: 50, minimum: 1 }));

const Nest = Schema.Array(
  Schema.Struct({
    budget: small,
    prep: Schema.Int.check(Schema.isBetween({ maximum: 10, minimum: 0 })),
  })
).check(Schema.isMinLength(1), Schema.isMaxLength(4));

const Attempts = Schema.Array(small).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(5)
);

it.effect.prop(
  "nested XRPC and retry sequences inherit the earliest absolute deadline and leave no active requests",
  [Nest, Attempts, small, small],
  ([nest, work, attemptBound, pause]) =>
    Effect.gen(function* proof() {
      const base = yield* Clock.currentTimeMillis;
      const observed: { at: number; deadline: number }[] = [];
      const ended: number[] = [];
      let active = 0;
      let elapsed = 0;
      let expectedDeadline = Number.POSITIVE_INFINITY;

      for (const step of nest) {
        expectedDeadline = Math.min(
          expectedDeadline,
          base + elapsed + step.budget
        );
        elapsed += step.prep;
      }

      expectedDeadline = Math.min(
        expectedDeadline,
        base + elapsed + attemptBound
      );

      const http = HttpClient.make((outgoing) =>
        Effect.gen(function* attempt() {
          const at = yield* Clock.currentTimeMillis;
          observed.push({ at, deadline: yield* Deadline.Deadline });
          active += 1;

          return yield* Effect.sleep(
            work[(observed.length - 1) % work.length] ?? 1
          ).pipe(
            Effect.andThen(
              Effect.fail(
                new HttpClientError.HttpClientError({
                  reason: new HttpClientError.TransportError({
                    cause: "simulated outage",
                    request: outgoing,
                  }),
                })
              )
            ),
            Effect.ensuring(
              Clock.currentTimeMillis.pipe(
                Effect.tap((time) =>
                  Effect.sync(() => {
                    active -= 1;
                    ended.push(time);
                  })
                )
              )
            )
          );
        })
      );

      let program = http
        .get("https://mail.example.invalid/xrpc/test")
        .pipe(
          Deadline.timeout(attemptBound),
          Effect.retry(
            Schedule.spaced(pause).pipe(
              Schedule.upTo({ times: work.length }),
              Deadline.retryBudget(attemptBound)
            )
          )
        );

      for (const step of nest.toReversed()) {
        program = Effect.sleep(step.prep).pipe(
          Effect.andThen(program),
          Deadline.timeout(step.budget)
        );
      }

      const fiber = yield* program.pipe(Effect.exit, Effect.forkScoped);
      yield* TestClock.adjust(1000);
      yield* Fiber.join(fiber);
      expect(active).toBe(0);
      expect(ended.every((at) => at <= base + (nest[0]?.budget ?? 0))).toBe(
        true
      );

      for (const [index, call] of observed.entries()) {
        const inherited = Math.min(
          ...nest.map(
            (step, i) =>
              base +
              nest.slice(0, i).reduce((sum, prior) => sum + prior.prep, 0) +
              step.budget
          )
        );

        expect(call.deadline).toBe(Math.min(inherited, call.at + attemptBound));
        expect(call.at).toBeLessThan(call.deadline);

        if (index === 0) {
          expect(call.deadline).toBe(expectedDeadline);
        } else {
          expect(inherited - call.at).toBeGreaterThanOrEqual(attemptBound);
        }
      }

      const count = observed.length;
      yield* TestClock.adjust(1000);
      expect(observed).toHaveLength(count);
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "caller interruption and deadlines abort FetchHttpClient during headers or body, without orphan work",
  [
    Schema.Literals(["headers", "body"]),
    small,
    small,
    Schema.Literals(["interrupt", "deadline", "request"]),
    Schema.Boolean,
  ],
  ([phase, depth, beforeCancel, cancel, lease]) =>
    Effect.gen(function* proof() {
      const own = yield* identity("did:web:caller.example.invalid");
      const ready = yield* Deferred.make<AbortSignal>();
      let active = 0;
      let aborted = 0;

      const fetch: typeof globalThis.fetch = (_url, init) => {
        const signal = init?.signal;

        if (signal === undefined || signal === null) {
          throw new Error("HTTP must carry an AbortSignal");
        }

        active += 1;

        return new Promise<Response>((resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              active -= 1;
              aborted += 1;
              reject(new Error("aborted"));
            },
            { once: true }
          );

          if (phase === "headers") {
            Deferred.doneUnsafe(ready, Effect.succeed(signal));
          } else {
            resolve(
              new Response(
                new ReadableStream({
                  pull: (controller) => {
                    Deferred.doneUnsafe(ready, Effect.succeed(signal));
                    signal.addEventListener(
                      "abort",
                      () => {
                        controller.error(new Error("aborted body"));
                      },
                      { once: true }
                    );
                  },
                })
              )
            );
          }
        });
      };

      const transport = yield* Transport.pipe(
        Effect.provide(
          transportLayer(
            "https://mail.example.invalid",
            "did:web:mail.example.invalid#mailbox",
            own
          ).pipe(Layer.provide(FetchHttpClient.layer))
        )
      );

      let call: Effect.Effect<unknown, Cause.TimeoutError | TransportFailure> =
        transport.request({
          ...request,
          nsid: lease ? "sh.mschf.ratking.runtime.renewLease" : request.nsid,
        });

      if (cancel !== "request") {
        for (let n = 0; n < depth; n += 1) {
          call = call.pipe(Deadline.timeout(1000 + n));
        }
      }

      const fiber = yield* call.pipe(
        Effect.provideService(FetchHttpClient.Fetch, fetch),
        Effect.exit,
        Effect.forkScoped
      );

      const signal = yield* Deferred.await(ready);

      if (cancel === "interrupt") {
        yield* TestClock.adjust(beforeCancel);
        yield* Fiber.interrupt(fiber);
      } else {
        const requestBound = lease ? Deadline.LEASE_MS : Deadline.REQUEST_MS;
        yield* TestClock.adjust(cancel === "deadline" ? 1000 : requestBound);
        yield* Fiber.join(fiber);
      }

      expect(signal.aborted).toBe(true);
      expect(active).toBe(0);
      expect(aborted).toBe(1);
      yield* TestClock.adjust(100_000);
      expect(active).toBe(0);
      expect(aborted).toBe(1);
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "expired callers never evaluate work and retry admission includes backoff plus a full attempt",
  [small, small, small],
  ([left, attempt, pause]) =>
    Effect.gen(function* proof() {
      const now = yield* Clock.currentTimeMillis;
      let called = false;
      yield* Effect.sync(() => {
        called = true;
      }).pipe(
        Deadline.timeout(1000),
        Effect.provideService(Deadline.Deadline, now),
        Effect.exit
      );
      expect(called).toBe(false);

      const fits = yield* Deadline.canAttempt(attempt, pause).pipe(
        Effect.provideService(Deadline.Deadline, now + left)
      );

      expect(fits).toBe(left >= attempt + pause);
    })
);
