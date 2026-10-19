import { it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import { expect } from "vitest";

import { makeMemoryRunBinding } from "../pass-bindings.ts";
import { TrustFailure } from "../trust-failure.ts";
import { keypair } from "./pass-helpers.ts";

it.effect.prop(
  "run tokens refuse wrong hashes and lifetimes over five minutes, then allow only bound renewal",
  [
    Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 300, minimum: 1 }))
    ),
  ],
  ([ttl]) =>
    Effect.gen(function* tokenCeilingProperty() {
      const worker = yield* keypair;
      const binding = yield* makeMemoryRunBinding();
      const tokenHash = "a".repeat(64);

      const invalid = yield* binding
        .open("over-cap", { exp: 300 + ttl, iat: 0, tokenHash }, 0)
        .pipe(Effect.flip);

      expect(invalid).toBeInstanceOf(TrustFailure);
      yield* binding.open("run", { exp: ttl, iat: 0, tokenHash }, 0);

      const wrong = yield* binding
        .claim("run", "b".repeat(64), worker.did, 0)
        .pipe(Effect.flip);

      expect(wrong).toBeInstanceOf(TrustFailure);
      expect(yield* binding.claim("run", tokenHash, worker.did, 0)).toBe(
        "bound"
      );
      expect(yield* binding.claim("run", tokenHash, worker.did, ttl + 1)).toBe(
        "match"
      );
      yield* binding.close("run");

      const closed = yield* binding
        .claim("run", tokenHash, worker.did, ttl + 1)
        .pipe(Effect.flip);

      expect(closed).toBeInstanceOf(TrustFailure);
    }),
  { arbitrary: { runs: 30 } }
);
