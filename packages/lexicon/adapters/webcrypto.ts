import { Effect, Layer } from "effect";
import * as Base64Url from "effect/encoding/Base64Url";

/* oxlint-disable typescript/promise-function-async -- WebCrypto methods are lazy Promise boundaries for Effect.tryPromise. */
import { Signatures, TrustFailure } from "../trust.ts";
import type { PublicKeyValue } from "../trust.ts";

const cryptoFailure = () =>
  new TrustFailure({ reason: "Cryptographic operation failed" });

export const signatures = Layer.succeed(
  Signatures,
  Signatures.of({
    digest: Effect.fn("Signatures.digest")(function* digestBytes(bytes) {
      const hash = yield* Effect.tryPromise({
        catch: cryptoFailure,
        try: () => crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)),
      });

      return Array.from(new Uint8Array(hash), (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("");
    }),
    verify: Effect.fn("Signatures.verify")(function* verifyBytes(
      key: PublicKeyValue,
      bytes,
      signature
    ) {
      const decoded = yield* Effect.fromResult(
        Base64Url.decode(signature)
      ).pipe(Effect.mapError(cryptoFailure));

      const imported = yield* Effect.tryPromise({
        catch: cryptoFailure,
        try: () =>
          crypto.subtle.importKey(
            "jwk",
            { crv: key.crv, kty: key.kty, x: key.x, y: key.y },
            { name: "ECDSA", namedCurve: "P-256" },
            false,
            ["verify"]
          ),
      });

      return yield* Effect.tryPromise({
        catch: cryptoFailure,
        try: () =>
          crypto.subtle.verify(
            { hash: "SHA-256", name: "ECDSA" },
            imported,
            Uint8Array.from(decoded),
            Uint8Array.from(bytes)
          ),
      });
    }),
  })
);
