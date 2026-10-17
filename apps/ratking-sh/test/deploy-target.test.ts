import { it } from "@effect/vitest";
import { Arbitrary, Effect, Exit, Schema } from "effect";
import { expect } from "vitest";

import { requireZoneAccount } from "../src/deploy-target.ts";

const Target = Schema.Struct({
  correctAccount: Schema.Boolean,
  correctStage: Schema.Boolean,
  wellFormed: Schema.Boolean,
});

it.effect.prop(
  "the Alchemy stage refuses any account other than the explicitly configured zone account",
  [Arbitrary.schema(Target)],
  ([input]) =>
    Effect.gen(function* accountGuard() {
      const expected = input.wellFormed ? "0".repeat(32) : "unconfigured";
      const actual = input.correctAccount ? expected : "1".repeat(32);

      const result = yield* requireZoneAccount(
        input.correctStage ? "public-edge" : "other",
        expected,
        actual
      ).pipe(Effect.exit);

      expect(Exit.isSuccess(result)).toBe(
        input.correctAccount && input.correctStage && input.wellFormed
      );
    })
);
