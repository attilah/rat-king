import { it } from "@effect/vitest";
import { Arbitrary, Effect, Ref, Schema } from "effect";

import {
  makeMemoryNonceBinding,
  makeMemoryRunBinding,
  NonceBinding,
  RunBinding,
} from "../../lexicon/pass-bindings.ts";
import { keypair } from "../../lexicon/test/pass-helpers.ts";
import { nonceModel, runModel } from "./desk-pass-binding-model.ts";

const runAction = Schema.Struct({
  kind: Schema.Literals(["open", "close", "claim", "expire", "renew"]),
  run: Schema.Int.check(Schema.isBetween({ maximum: 3, minimum: 0 })),
  worker: Schema.Int.check(Schema.isBetween({ maximum: 1, minimum: 0 })),
});

const nonceAction = Schema.Struct({
  advance: Schema.Boolean,
  run: Schema.Int.check(Schema.isBetween({ maximum: 2, minimum: 0 })),
  worker: Schema.Int.check(Schema.isBetween({ maximum: 2, minimum: 0 })),
});

it.effect.prop(
  "run claims and renewals match the lifecycle model, including reuse, expiry, closed-run and other-worker renewal plants",
  [Arbitrary.schema(Schema.Array(runAction).check(Schema.isMaxLength(50)))],
  ([actions]) =>
    Effect.gen(function* runLifecycleProperty() {
      const first = yield* keypair;
      const second = yield* keypair;
      const binding = yield* makeMemoryRunBinding();
      yield* runModel(actions, [first.did, second.did]).pipe(
        Effect.provideService(RunBinding, binding)
      );
    }),
  { arbitrary: { runs: 50 } }
);

it.effect.prop(
  "nonce bindings match their retention and identity model after every command",
  [
    Arbitrary.schema(
      Schema.Array(nonceAction).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(50)
      )
    ),
  ],
  ([actions]) =>
    Effect.gen(function* nonceLifecycleProperty() {
      const clock = yield* Ref.make(0);
      const binding = yield* makeMemoryNonceBinding(Ref.get(clock));
      yield* nonceModel(actions, clock).pipe(
        Effect.provideService(NonceBinding, binding)
      );
    }),
  { arbitrary: { runs: 100 } }
);
