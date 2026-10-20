import { it } from "@effect/vitest";
import { Arbitrary, Effect, Option, Schema } from "effect";
import { expect } from "vitest";

import { signatures } from "../adapters/webcrypto.ts";
import {
  PassRequest,
  passRequestBytes,
  signPassRequest,
} from "../pass-request.ts";
import {
  decodeDidKey,
  encodeDidKey,
  makeMemoryNonceBinding,
  NonceBinding,
  verifyPass,
  verifyRequest,
} from "../passes.ts";
import { TrustFailure } from "../trust.ts";
import { didForBytes, fixture, keypair, Variation } from "./pass-helpers.ts";

const refused = <A, R>(effect: Effect.Effect<A, TrustFailure, R>) =>
  effect.pipe(
    Effect.flip,
    Effect.tap((failure) =>
      Effect.sync(() => {
        expect(failure).toBeInstanceOf(TrustFailure);
        expect(failure.reason.split(";")).toHaveLength(3);
      })
    )
  );

const point = Schema.Struct({
  odd: Schema.Boolean,
  x: Schema.Array(
    Schema.Int.check(Schema.isBetween({ maximum: 255, minimum: 0 }))
  ).check(Schema.isMinLength(32), Schema.isMaxLength(32)),
});

it.effect.prop(
  "did:key encoding inverts decoding for every valid point and refuses off-curve keys",
  [Arbitrary.schema(point)],
  ([input]) =>
    Effect.gen(function* didKeyRoundTripProperty() {
      const did = didForBytes(
        Uint8Array.from([0x80, 0x24, input.odd ? 3 : 2, ...input.x])
      );

      const decoded = yield* decodeDidKey(did).pipe(Effect.option);

      if (Option.isSome(decoded)) {
        expect(yield* encodeDidKey(decoded.value)).toBe(did);
        expect(yield* decodeDidKey(yield* encodeDidKey(decoded.value))).toEqual(
          decoded.value
        );
        yield* refused(encodeDidKey({ ...decoded.value, y: decoded.value.x }));
      }

      const generated = yield* keypair;
      expect(yield* encodeDidKey(generated.publicKey)).toBe(generated.did);
    }),
  { arbitrary: { runs: 40 } }
);

const base64url = (length: string) =>
  Schema.String.check(
    Schema.isPattern(new RegExp(`^[A-Za-z0-9_-]${length}$`, "u"))
  );

const Request = Schema.Struct({
  aud: Schema.String.check(
    Schema.isPattern(
      /^did:[a-z]{1,8}:[A-Za-z0-9._:%-]{1,64}#[A-Za-z0-9._~-]{1,16}$/u
    )
  ),
  envelopeDigest: base64url("{43}"),
  exp: PassRequest.schema.fields.exp,
  iat: PassRequest.schema.fields.iat,
  intent: Schema.Struct({
    wakeReason: Schema.Literals(["to", "quiet"]),
    woke: Schema.Boolean,
  }),
  jti: base64url("{16,128}"),
  lxm: Schema.Literals([
    "sh.mschf.ratking.mailbox.sendViaPass",
    "sh.mschf.ratking.mailbox.send",
  ]),
  passDigest: base64url("{43}"),
});

const fields = [
  "aud",
  "envelopeDigest",
  "exp",
  "iat",
  "intent",
  "jti",
  "lxm",
  "passDigest",
] as const;

it.effect.prop(
  "changing any one signed request field, or adding one, makes verifyRequest refuse",
  [
    Arbitrary.schema(Variation),
    Arbitrary.schema(Request),
    Arbitrary.schema(Request),
  ],
  ([input, request, other]) =>
    Effect.gen(function* passRequestProperty() {
      const sample = yield* fixture(input);
      const binding = yield* makeMemoryNonceBinding(Effect.succeed(input.now));

      const pass = yield* verifyPass(sample.known, sample.pass, input.now).pipe(
        Effect.provideService(NonceBinding, binding)
      );

      const signature = yield* signPassRequest(sample.worker.signer, request);
      yield* verifyRequest(pass, yield* passRequestBytes(request), signature);

      for (const field of fields) {
        const changed = { ...request, [field]: other[field] };

        if (JSON.stringify(changed) !== JSON.stringify(request)) {
          yield* refused(
            verifyRequest(pass, yield* passRequestBytes(changed), signature)
          );
        }
      }

      const flipped = {
        ...request,
        intent: { ...request.intent, woke: !request.intent.woke },
      };

      yield* refused(
        verifyRequest(pass, yield* passRequestBytes(flipped), signature)
      );
      yield* refused(passRequestBytes({ ...request, cc: "extra" }));
      yield* refused(passRequestBytes({ ...request, aud: "\uD800" }));
      yield* refused(
        verifyRequest(
          pass,
          yield* passRequestBytes(request),
          yield* signPassRequest(sample.desk.signer, request)
        )
      );
    }).pipe(Effect.provide(signatures)),
  { arbitrary: { runs: 25 } }
);
