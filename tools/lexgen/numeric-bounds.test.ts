import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, FileSystem, Schema } from "effect";
import { expect } from "vitest";

it.effect.prop(
  "generated numeric bounds match lint grouping at four and five digits",
  [Schema.Literals([1440, 10_000])],
  ([bound]) =>
    Effect.gen(function* numericBounds() {
      const fs = yield* FileSystem.FileSystem;

      const source = yield* fs.readFileString(
        "packages/lexicon/src/attention.prefs.ts"
      );

      expect(source).toContain(
        `Schema.isLessThanOrEqualTo(${bound === 1440 ? "1440" : "10_000"})`
      );
    }).pipe(Effect.provide(NodeServices.layer))
);
