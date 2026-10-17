/* oxlint-disable typescript/promise-function-async -- WebCrypto test adapters supply lazy Promise thunks to Effect.tryPromise. */
import { Effect, Layer, Schema } from "effect";
import * as Base64Url from "effect/encoding/Base64Url";

import { signatures } from "../adapters/webcrypto.ts";
import * as Invite from "../src/edge.invite.ts";
import * as Revocation from "../src/edge.revocation.ts";
import {
  Identity,
  PublicKey,
  Signatures,
  TrustAuthority,
  TrustFailure,
  fingerprintBytes,
  signingBytes,
} from "../trust.ts";
import type {
  Attestation,
  SignedRevocationValue,
  CredentialValue,
} from "../trust.ts";

export const now = 1_893_456_120_000;

export const issuer = "did:web:issuer.example.invalid";

export const subject = "did:web:guest.example.invalid";

export const issuerKeyId = `${issuer}#signing`;

export const subjectKeyId = `${subject}#signing`;

const cryptoFailure = () =>
  new TrustFailure({ reason: "Test cryptographic operation failed" });

export const keypair = Effect.gen(function* generateKeypair() {
  const keys = yield* Effect.tryPromise({
    catch: cryptoFailure,
    try: () =>
      crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
        "sign",
        "verify",
      ]),
  });

  const exported = yield* Effect.tryPromise({
    catch: cryptoFailure,
    try: () => crypto.subtle.exportKey("jwk", keys.publicKey),
  });

  return {
    keys,
    publicKey: yield* Schema.decodeUnknownEffect(PublicKey)(exported),
  };
});

export const sign = (key: CryptoKey, bytes: Uint8Array) =>
  Effect.tryPromise({
    catch: cryptoFailure,
    try: () =>
      crypto.subtle.sign(
        { hash: "SHA-256", name: "ECDSA" },
        key,
        Uint8Array.from(bytes)
      ),
  }).pipe(
    Effect.map((signature) => Base64Url.encode(new Uint8Array(signature)))
  );

export const fixture = Effect.gen(function* inviteFixture() {
  const host = yield* keypair;
  const guest = yield* keypair;
  const crypto = yield* Signatures;
  const fingerprint = yield* crypto.digest(fingerprintBytes(guest.publicKey));

  const record = yield* Schema.decodeUnknownEffect(Invite.Main)({
    $type: "sh.ratking.invite",
    allowFleetOutbound: false,
    createdAt: "2030-01-01T00:00:00Z",
    expiresAt: "2030-01-01T01:00:00Z",
    issuer,
    namespace: "ext/example/",
    ratePerMinute: 10,
    recipients: ["lobby"],
    subject,
    subjectKey: fingerprint,
  });

  const invite = {
    keyId: issuerKeyId,
    record,
    signature: yield* sign(
      host.keys.privateKey,
      signingBytes(record, issuerKeyId)
    ),
  };

  const identityRecord = yield* Schema.decodeUnknownEffect(Identity)({
    $type: "sh.ratking.identity",
    atprotoHandle: "guest.example.invalid",
    audience: "https://ratking.sh/mcp",
    createdAt: "2030-01-01T00:00:00Z",
    expiresAt: "2030-01-01T00:05:00Z",
    handle: "ext/example/guest",
    publicKey: guest.publicKey,
    subject,
  });

  const identity = {
    keyId: subjectKeyId,
    record: identityRecord,
    signature: yield* sign(
      guest.keys.privateKey,
      signingBytes(identityRecord, subjectKeyId)
    ),
  };

  const revocationRecord = yield* Schema.decodeUnknownEffect(Revocation.Main)({
    $type: "sh.ratking.revocation",
    createdAt: "2030-01-01T00:00:30Z",
    invite: yield* crypto.digest(signingBytes(record, issuerKeyId)),
    issuer,
  });

  const revocation = {
    keyId: issuerKeyId,
    record: revocationRecord,
    signature: yield* sign(
      host.keys.privateKey,
      signingBytes(revocationRecord, issuerKeyId)
    ),
  };

  return { fingerprint, guest, host, identity, invite, revocation };
}).pipe(Effect.provide(signatures));

export const testAuthority = (
  key: typeof PublicKey.Type,
  revocations: readonly SignedRevocationValue[] = [],
  attestation?: Attestation
) =>
  Layer.succeed(
    TrustAuthority,
    TrustAuthority.of({
      identity: (keyId) =>
        Effect.succeed(keyId === subjectKeyId ? attestation : undefined),
      issuer: (did, keyId) =>
        did === issuer && keyId === issuerKeyId
          ? Effect.succeed({ key, namespaces: ["ext/example/"] })
          : Effect.fail(new TrustFailure({ reason: "Unknown issuer" })),
      revocations: () => Effect.succeed(revocations),
    })
  );

export const credential = (
  sample: Effect.Success<typeof fixture>,
  withInvite: boolean
): CredentialValue =>
  withInvite
    ? { identity: sample.identity, invite: sample.invite }
    : { identity: sample.identity };
