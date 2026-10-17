import { Context } from "effect";
import type { Effect } from "effect";

import type { TrustFailure } from "./trust-failure.ts";
import type { PublicKeyValue } from "./trust.ts";

export class Signatures extends Context.Service<
  Signatures,
  {
    readonly verify: (
      key: PublicKeyValue,
      bytes: Uint8Array,
      signature: string
    ) => Effect.Effect<boolean, TrustFailure>;
    readonly digest: (bytes: Uint8Array) => Effect.Effect<string, TrustFailure>;
  }
>()("ratking/Signatures") {}
