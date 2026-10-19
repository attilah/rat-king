import { Effect } from "effect";
import * as Base64Url from "effect/encoding/Base64Url";

import { refusal } from "../pass-failure.ts";
import type { SigningKey } from "../passes.ts";
import type { PublicKeyValue } from "../trust.ts";

export const signingKey = (
  publicKey: PublicKeyValue,
  privateKey: Parameters<typeof crypto.subtle.sign>[1]
): SigningKey => ({
  publicKey,
  sign: (bytes) =>
    Effect.tryPromise({
      catch: () =>
        refusal(
          "Signing refused",
          "ES256 signing failed",
          "use the matching P-256 private key"
        ),
      try: crypto.subtle.sign.bind(
        crypto.subtle,
        { hash: "SHA-256", name: "ECDSA" },
        privateKey,
        Uint8Array.from(bytes)
      ),
    }).pipe(
      Effect.map((signature) => Base64Url.encode(new Uint8Array(signature)))
    ),
});
