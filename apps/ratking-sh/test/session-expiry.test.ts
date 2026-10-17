import { it } from "@effect/vitest";
import { signatures } from "@rat-king/lexicon/webcrypto";
import { Arbitrary, Effect, Layer, Option, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { now } from "../../../packages/lexicon/test/trust-helpers.ts";
import { authorityFrom } from "../src/authority.ts";
import { handleContact } from "../src/session.ts";
import type { StoredSessionValue } from "../src/session.ts";
import { externalId, legacyRequest } from "./http-helpers.ts";

it.effect.prop(
  "durable contact initialization expires at the 24-hour boundary, not on a process restart",
  [Arbitrary.schema(Schema.Literals([-1, 0, 1]))],
  ([offset]) =>
    Effect.gen(function* sessionDeadline() {
      yield* TestClock.setTime(now);

      const stored = yield* Ref.make<Option.Option<StoredSessionValue>>(
        Option.none()
      );

      const storage = {
        load: Ref.get(stored).pipe(Effect.map(Option.getOrUndefined)),
        save: (value: StoredSessionValue) =>
          Ref.set(stored, Option.some(value)),
      };

      const initialize = legacyRequest("initialize");
      const body = yield* Effect.promise(initialize.text.bind(initialize));

      const opened = yield* handleContact(
        initialize,
        body,
        externalId,
        "lobby",
        storage
      );

      yield* Effect.promise(opened.text.bind(opened));
      yield* TestClock.adjust(86_400_000 + offset);
      const call = legacyRequest("tools/call");

      const result = yield* handleContact(
        call,
        yield* Effect.promise(call.text.bind(call)),
        externalId,
        "lobby",
        storage
      );

      expect(result.status).toBe(offset < 0 ? 200 : 404);
      yield* Effect.promise(result.text.bind(result));
    }).pipe(Effect.provide(Layer.merge(signatures, authorityFrom()))),
  { arbitrary: { runs: 6 } }
);
