import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { expect } from "vitest";

import { testLayer } from "../adapters/testing.ts";
import { postObservation } from "../src/pipeline.ts";
import { draft, fixture, slice } from "./fixtures.ts";

const Pattern = Schema.Literals([
  "bearer",
  "blob",
  "email",
  "hex",
  "home",
  "ip",
  "key",
  "token",
]);

it.effect.prop(
  "regex redaction removes generated sensitive strings from claim metadata and subject-vector keys before durable output",
  [Pattern, Schema.Int.check(Schema.isBetween({ maximum: 1000, minimum: 0 }))],
  ([pattern, seed]) => {
    const values = {
      bearer: ["Bearer", "Z".repeat(24), seed].join(" "),
      blob: "Z".repeat(56),
      email: ["person", seed, "@", "example", ".invalid"].join(""),
      hex: "a".repeat(40),
      home: ["", "home", `fixture-${seed}`].join("/"),
      ip: [10, 7, seed % 200, 2].join("."),
      key: [
        "-----BEGIN ",
        "PRIVATE",
        " KEY-----\n",
        "fixture",
        "\n-----END ",
        "PRIVATE",
        " KEY-----",
      ].join(""),
      token: ["sk", "-", "q".repeat(20), seed].join(""),
    };

    const value = values[pattern];
    const candidate = draft("one", seed);
    const sentence = `Orchid contact ${value}.`;

    const observed = {
      ...candidate,
      claim: {
        ...candidate.claim,
        concepts: [value],
        project: value,
        sentence,
      },
      subject: { [value]: 1 },
    };

    return Effect.gen(function* redactionProof() {
      const result = yield* postObservation(slice("one"), [
        { ...observed, claim: { ...observed.claim, concepts: [value] } },
      ]);

      expect(result.candidates).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain(value);
    }).pipe(Effect.provide(testLayer(fixture(seed))));
  }
);
