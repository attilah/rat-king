import { encode } from "@ipld/dag-cbor";
import { DateTime, Effect, Schema } from "effect";

import * as IdentityRecord from "./src/edge.identity.ts";
import * as Invite from "./src/edge.invite.ts";
import * as Revocation from "./src/edge.revocation.ts";
import type * as Runtime from "./src/runtime.ts";
import { TrustAuthority } from "./trust-authority.ts";
import { TrustFailure } from "./trust-failure.ts";
import { Signatures } from "./trust-signatures.ts";

export { TrustAuthority } from "./trust-authority.ts";

export { TrustFailure } from "./trust-failure.ts";

export { Signatures } from "./trust-signatures.ts";

export type { Attestation, Issuer } from "./trust-authority.ts";

const coordinate = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{43}$/u)
);

export const PublicKey = Schema.Struct({
  crv: Schema.Literal("P-256"),
  kty: Schema.Literal("EC"),
  x: coordinate,
  y: coordinate,
});

export type PublicKeyValue = typeof PublicKey.Type;

const signature = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{86}$/u));

const keyId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(512)
);

export const SignedInvite = Schema.Struct({
  keyId,
  record: Invite.Main,
  signature,
});

export type SignedInviteValue = typeof SignedInvite.Type;

export const SignedRevocation = Schema.Struct({
  keyId,
  record: Revocation.Main,
  signature,
});

export type SignedRevocationValue = typeof SignedRevocation.Type;

export const Identity = IdentityRecord.Main;

export type IdentityValue = typeof Identity.Type;

export const Credential = Schema.Struct({
  identity: Schema.Struct({ keyId, record: Identity, signature }),
  invite: Schema.optionalKey(SignedInvite),
});

export type CredentialValue = typeof Credential.Type;

export const Tier = Schema.Literals([0, 1, 2, 3, 4]);

export const TierDescription = Schema.Struct({
  name: Schema.String,
  proves: Schema.String,
  tier: Tier,
});

export const tiers = [
  { name: "stranger", proves: "Nothing. Read-only lobby access.", tier: 0 },
  {
    name: "self-keyed",
    proves: "Key continuity, not the claimed DID or handle.",
    tier: 1,
  },
  {
    name: "domain",
    proves: "An authority-verified atproto DID and handle binding.",
    tier: 2,
  },
  {
    name: "vouched",
    proves: "A fleet member signed a scoped, unexpired invite.",
    tier: 3,
  },
  {
    name: "fleet",
    proves: "An identity attested by the host issuer.",
    tier: 4,
  },
] as const;

export const signingBytes = (record: Runtime.LexValue, signingKeyId: string) =>
  encode({ domain: "sh.ratking.record.v1", keyId: signingKeyId, record });

export const fingerprintBytes = (key: PublicKeyValue) =>
  encode({ crv: key.crv, kty: key.kty, x: key.x, y: key.y });

const epoch = (value: string) =>
  Schema.decodeUnknownEffect(Schema.DateTimeUtcFromString)(value).pipe(
    Effect.map(DateTime.toEpochMillis),
    Effect.mapError(() => new TrustFailure({ reason: "Invalid record time" }))
  );

const lifetime = Effect.fn("Trust.lifetime")(function* checkLifetime(
  createdAt: string,
  expiresAt: string,
  now: number
) {
  const created = yield* epoch(createdAt);
  const expires = yield* epoch(expiresAt);

  if (created > now || expires <= now || expires <= created) {
    return yield* new TrustFailure({ reason: "Record is not currently valid" });
  }

  return expires;
});

const verifyIssued = Effect.fn("Trust.verifyIssued")(
  function* verifyIssuedRecord(
    record: Runtime.LexValue,
    issuer: string,
    signingKeyId: string,
    signed: string
  ) {
    if (!signingKeyId.startsWith(`${issuer}#`)) {
      return yield* new TrustFailure({
        reason: "Signing key does not belong to issuer",
      });
    }

    const authority = yield* TrustAuthority;
    const allowed = yield* authority.issuer(issuer, signingKeyId);
    const crypto = yield* Signatures;

    if (
      !(yield* crypto.verify(
        allowed.key,
        signingBytes(record, signingKeyId),
        signed
      ))
    ) {
      return yield* new TrustFailure({ reason: "Invalid record signature" });
    }

    return allowed;
  }
);

export const InviteScope = Schema.Struct({
  handle: Identity.schema.fields.handle,
  recipient: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(256)
  ),
  subject: Identity.schema.fields.subject,
  subjectKey: Invite.Main.schema.fields.subjectKey,
});

export type InviteScopeValue = typeof InviteScope.Type;

export const VerifiedInvite = Schema.Struct({
  allowFleetOutbound: Schema.Boolean,
  expiresAt: Schema.String,
  fingerprint: Schema.String,
  namespace: Schema.String,
  ratePerMinute: Schema.Int,
  recipients: Schema.Array(Schema.String),
  tier: Schema.Literal(3),
});

export type VerifiedInviteValue = typeof VerifiedInvite.Type;

export const verifyInvite = Effect.fn("Trust.verifyInvite")(
  function* verifyInviteRecord(
    signed: SignedInviteValue,
    scope: InviteScopeValue,
    now: number
  ) {
    const { record } = signed;

    const grant = yield* verifyIssued(
      record,
      record.issuer,
      signed.keyId,
      signed.signature
    );

    yield* lifetime(record.createdAt, record.expiresAt, now);

    if (
      !grant.namespaces.includes(record.namespace) ||
      !scope.handle.startsWith(record.namespace) ||
      scope.subject !== record.subject ||
      scope.subjectKey !== record.subjectKey ||
      !record.recipients.includes(scope.recipient)
    ) {
      return yield* new TrustFailure({
        reason: "Invite is outside the requested scope",
      });
    }

    const crypto = yield* Signatures;

    const fingerprint = yield* crypto.digest(
      signingBytes(record, signed.keyId)
    );

    const authority = yield* TrustAuthority;

    for (const revoked of yield* authority.revocations(record.issuer)) {
      yield* verifyIssued(
        revoked.record,
        revoked.record.issuer,
        revoked.keyId,
        revoked.signature
      );

      if (
        revoked.record.issuer !== record.issuer ||
        (yield* epoch(revoked.record.createdAt)) > now
      ) {
        return yield* new TrustFailure({
          reason: "Invalid revocation snapshot",
        });
      }

      if (revoked.record.invite === fingerprint) {
        return yield* new TrustFailure({ reason: "Invite has been revoked" });
      }
    }

    return VerifiedInvite.make({
      allowFleetOutbound: record.allowFleetOutbound,
      expiresAt: record.expiresAt,
      fingerprint,
      namespace: record.namespace,
      ratePerMinute: record.ratePerMinute,
      recipients: record.recipients,
      tier: 3,
    });
  }
);

export const TrustResult = Schema.Struct({
  fingerprint: Schema.NullOr(Schema.String),
  handle: Schema.NullOr(Schema.String),
  invite: Schema.NullOr(VerifiedInvite),
  subject: Schema.NullOr(Schema.String),
  tier: Tier,
});

export type TrustResultValue = typeof TrustResult.Type;

export const stranger = TrustResult.make({
  fingerprint: null,
  handle: null,
  invite: null,
  subject: null,
  tier: 0,
});

export const whoami = Effect.fn("Trust.whoami")(function* inspectIdentity(
  credential: CredentialValue | undefined,
  recipient: string,
  now: number
) {
  if (credential === undefined) {
    return stranger;
  }

  const { identity } = credential;
  const { record } = identity;
  yield* lifetime(record.createdAt, record.expiresAt, now);

  if (
    (yield* epoch(record.expiresAt)) - (yield* epoch(record.createdAt)) >
    300_000
  ) {
    return yield* new TrustFailure({
      reason: "Identity credential exceeds five minutes",
    });
  }

  const crypto = yield* Signatures;

  if (
    !(yield* crypto.verify(
      record.publicKey,
      signingBytes(record, identity.keyId),
      identity.signature
    ))
  ) {
    return yield* new TrustFailure({ reason: "Invalid identity signature" });
  }

  const fingerprint = yield* crypto.digest(fingerprintBytes(record.publicKey));
  const authority = yield* TrustAuthority;
  const attestation = yield* authority.identity(identity.keyId);

  const attested =
    attestation !== undefined &&
    attestation.subject === record.subject &&
    attestation.handle === record.handle &&
    attestation.atprotoHandle === record.atprotoHandle &&
    attestation.fingerprint === fingerprint;

  const invite =
    credential.invite === undefined
      ? null
      : yield* verifyInvite(
          credential.invite,
          {
            handle: record.handle,
            recipient,
            subject: record.subject,
            subjectKey: fingerprint,
          },
          now
        );

  let tier: typeof Tier.Type = attested ? attestation.tier : 1;

  if (invite !== null && tier !== 4) {
    tier = 3;
  }

  return TrustResult.make({
    fingerprint,
    handle: record.handle,
    invite,
    subject: attested ? record.subject : null,
    tier,
  });
});
