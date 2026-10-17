import { it } from "@effect/vitest";
import { signatures } from "@rat-king/lexicon/webcrypto";
import {
  Arbitrary,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Option,
  Ref,
  Schema,
} from "effect";
import { expect } from "vitest";

import { authorityFrom } from "../src/authority.ts";
import { contactDispatcher } from "../src/contact-handler.ts";
import type { StoredSessionValue } from "../src/session.ts";
import { externalId, legacyRequest } from "./http-helpers.ts";

it.effect.prop(
  "overlapping initializations admit exactly one durable contact",
  [
    Arbitrary.schema(
      Schema.Literals(["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"])
    ),
  ],
  ([version]) =>
    Effect.gen(function* overlappingInitialization() {
      const stored = yield* Ref.make<Option.Option<StoredSessionValue>>(
        Option.none()
      );

      const firstLoad = yield* Deferred.make<boolean>();
      const releaseLoad = yield* Deferred.make<boolean>();
      const reads = yield* Ref.make(0);

      const dispatch = yield* contactDispatcher("lobby", {
        load: Effect.gen(function* suspendedLoad() {
          const count = yield* Ref.updateAndGet(reads, (value) => value + 1);
          const snapshot = Option.getOrUndefined(yield* Ref.get(stored));

          if (count === 1) {
            yield* Deferred.succeed(firstLoad, true);
            yield* Deferred.await(releaseLoad);
          }

          return snapshot;
        }),
        save: (value) => Ref.set(stored, Option.some(value)),
      });

      const firstRequest = legacyRequest("initialize", version);
      const secondRequest = legacyRequest("initialize", version);
      const body = yield* Effect.promise(firstRequest.text.bind(firstRequest));

      const first = yield* dispatch(firstRequest, body, externalId).pipe(
        Effect.forkChild
      );

      yield* Deferred.await(firstLoad);

      const second = yield* dispatch(secondRequest, body, externalId).pipe(
        Effect.forkChild
      );

      yield* Effect.yieldNow;
      yield* Deferred.succeed(releaseLoad, true);

      const responses = yield* Effect.all([
        Fiber.join(first),
        Fiber.join(second),
      ]);

      expect(
        responses
          .map((response) => response.status)
          .toSorted((left, right) => left - right)
      ).toEqual([200, 409]);
      expect(Option.getOrUndefined(yield* Ref.get(stored))?.phase).toBe(
        "active"
      );
    }).pipe(Effect.provide(Layer.merge(signatures, authorityFrom())))
);
