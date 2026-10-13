import { it } from "@effect/vitest";
import * as Friction from "@rat-king/lexicon/agentgraph.friction";
import { Arbitrary, Effect, Option, Schema } from "effect";
import { expect } from "vitest";

import { validateRecord } from "../src/agentgraph.ts";
import { recordNotice } from "../src/record-visibility.ts";

const valid = {
  $type: "sh.mschf.agentgraph.friction",
  at: "2030-01-01T00:00:00Z",
  graph: "coordination",
  id: "c0-f1",
  kind: "manual",
  minutes: 2,
  project: "sample",
  ref: "sample:receipt",
  slice: "f0",
  version: "0.1",
  what: "The owner repeated a manual step",
};

it.effect.prop(
  "friction round-trips every kind and stays silent",
  [
    Arbitrary.schema(
      Schema.Literals(["manual", "retry", "refusal", "surprise", "cleanup"])
    ),
  ],
  ([kind]) =>
    Effect.gen(function* proof() {
      const input = { ...valid, kind };
      const value = yield* validateRecord(input.$type, input);
      const decoded = yield* Schema.decodeUnknownEffect(Friction.Main)(value);

      const json = yield* Schema.encodeEffect(
        Schema.fromJsonString(Friction.Main)
      )(decoded);

      expect(
        yield* Schema.decodeEffect(Schema.fromJsonString(Friction.Main))(json)
      ).toEqual(decoded);
      expect(
        recordNotice(
          {
            body: json,
            did: "did:web:desk.invalid",
            from: "desk",
            id: "id",
            verified: true,
          },
          false
        )
      ).toBeUndefined();
    })
);

const Invalid = Schema.Literals(["kind", "what", "body"]);

it.effect.prop(
  "friction rejects an unknown kind, 281-character what and an extra body field",
  [Arbitrary.schema(Invalid)],
  ([field]) =>
    Effect.gen(function* refusal() {
      const changed = {
        body: "not allowed",
        kind: "unknown",
        what: "x".repeat(281),
      };

      const exit = yield* validateRecord(valid.$type, {
        ...valid,
        [field]: changed[field],
      }).pipe(Effect.exit);

      expect(exit._tag).toBe("Failure");
      expect(
        Option.isNone(
          Schema.decodeUnknownOption(Friction.Main)({
            ...valid,
            [field]: changed[field],
          })
        )
      ).toBe(true);
    })
);
