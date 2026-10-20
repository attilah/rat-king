import { encode } from "@ipld/dag-cbor";
import { Effect, Schema } from "effect";

import { refusal } from "./pass-failure.ts";
import { signRequest } from "./passes.ts";
import type { SigningKey } from "./passes.ts";
import { PassRequest } from "./src/defs.ts";
import type { LexValue } from "./src/runtime.ts";

export { PassRequest, PassRun } from "./src/defs.ts";

export type { PassRequestValue, PassRunValue } from "./src/defs.ts";

export const passRequestBytes = Effect.fn("Passes.passRequestBytes")(
  function* passRequestBytes(input: LexValue) {
    const request = yield* Schema.decodeUnknownEffect(PassRequest)(input).pipe(
      Effect.mapError(() =>
        refusal(
          "Request refused",
          "request does not match the pass request schema",
          "sign exactly aud, lxm, iat, exp, jti, envelopeDigest, passDigest and intent"
        )
      )
    );

    return yield* Effect.try({
      catch: () =>
        refusal(
          "Request refused",
          "request cannot be encoded as DAG-CBOR",
          "provide a canonical pass request"
        ),
      try: (): Uint8Array =>
        encode({ domain: "sh.ratking.pass.request.v1", request }),
    });
  }
);

export const signPassRequest = Effect.fn("Passes.signPassRequest")(
  function* signPassRequest(workerKey: SigningKey, request: LexValue) {
    return yield* signRequest(workerKey, yield* passRequestBytes(request));
  }
);
