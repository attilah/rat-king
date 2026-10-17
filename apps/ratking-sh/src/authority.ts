import {
  PublicKey,
  SignedRevocation,
  TrustAuthority,
  TrustFailure,
} from "@rat-king/lexicon/trust";
import { Clock, Config, DateTime, Effect, Layer, Option, Schema } from "effect";

const Attestation = Schema.Struct({
  atprotoHandle: Schema.String,
  fingerprint: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
  handle: Schema.String,
  keyId: Schema.String,
  subject: Schema.String.check(Schema.isPattern(/^did:(?:plc|web):/u)),
  tier: Schema.Literals([2, 4]),
});

export const Directory = Schema.Struct({
  expiresAt: Schema.DateTimeUtcFromString,
  identities: Schema.Array(Attestation),
  issuers: Schema.Array(
    Schema.Struct({
      did: Schema.String,
      key: PublicKey,
      keyId: Schema.String,
      namespaces: Schema.Array(Schema.String),
    })
  ),
  revocations: Schema.Array(SignedRevocation),
});

export const authorityFrom = (directory?: typeof Directory.Type) => {
  const fresh = Effect.gen(function* freshSnapshot() {
    if (
      directory === undefined ||
      DateTime.toEpochMillis(directory.expiresAt) <=
        (yield* Clock.currentTimeMillis)
    ) {
      return yield* new TrustFailure({
        reason: "Trust authority is unavailable or stale",
      });
    }

    return directory;
  });

  return Layer.succeed(
    TrustAuthority,
    TrustAuthority.of({
      identity: Effect.fn("TrustAuthority.identity")(
        function* attestedIdentity(keyId) {
          if (directory === undefined) {
            return yield* Effect.succeed(directory);
          }

          return (yield* fresh).identities.find(
            (entry) => entry.keyId === keyId
          );
        }
      ),
      issuer: Effect.fn("TrustAuthority.issuer")(
        function* authorizedIssuer(did, keyId) {
          const issuer = (yield* fresh).issuers.find(
            (entry) => entry.did === did && entry.keyId === keyId
          );

          if (issuer === undefined) {
            return yield* new TrustFailure({
              reason: "Issuer is not authorized to vouch",
            });
          }

          return issuer;
        }
      ),
      revocations: Effect.fn("TrustAuthority.revocations")(
        function* revokedRecords(issuer) {
          return (yield* fresh).revocations.filter(
            (entry) => entry.record.issuer === issuer
          );
        }
      ),
    })
  );
};

export const authority = Layer.unwrap(
  Effect.gen(function* configuredAuthority() {
    const configured = yield* Config.option(
      Config.String("RATKING_TRUST_DIRECTORY")
    );

    const directory = Option.isNone(configured)
      ? undefined
      : yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Directory))(
          configured.value
        );

    return authorityFrom(directory);
  })
);
