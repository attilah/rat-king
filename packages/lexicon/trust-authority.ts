import { Context } from "effect";
import type { Effect } from "effect";

import type { TrustFailure } from "./trust-failure.ts";
import type { PublicKeyValue, SignedRevocationValue } from "./trust.ts";

export interface Issuer {
  readonly key: PublicKeyValue;
  readonly namespaces: readonly string[];
}

export interface Attestation {
  readonly subject: string;
  readonly handle: string;
  readonly fingerprint: string;
  readonly atprotoHandle: string;
  readonly tier: 2 | 4;
}

export class TrustAuthority extends Context.Service<
  TrustAuthority,
  {
    readonly issuer: (
      did: string,
      keyId: string
    ) => Effect.Effect<Issuer, TrustFailure>;
    readonly revocations: (
      issuer: string
    ) => Effect.Effect<readonly SignedRevocationValue[], TrustFailure>;
    readonly identity: (
      keyId: string
    ) => Effect.Effect<Attestation | undefined, TrustFailure>;
  }
>()("ratking/TrustAuthority") {}
