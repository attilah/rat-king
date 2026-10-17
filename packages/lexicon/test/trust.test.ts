import { it } from "@effect/vitest";
import { Arbitrary, DateTime, Effect, Schema } from "effect";
import { expect } from "vitest";

import { signatures } from "../adapters/webcrypto.ts";
import * as Invite from "../src/edge.invite.ts";
import {
  InviteScope,
  Signatures,
  TrustFailure,
  verifyInvite,
  whoami,
  signingBytes,
} from "../trust.ts";
import {
  credential,
  fixture,
  issuerKeyId,
  now,
  sign,
  subject,
  testAuthority,
} from "./trust-helpers.ts";

const Variation = Schema.Struct({
  allowOutbound: Schema.Boolean,
  nonce: Schema.String,
  rate: Schema.Int.check(Schema.isBetween({ maximum: 120, minimum: 1 })),
});

const variations = Arbitrary.schema(Variation);

it.effect.prop(
  "invite validity requires an authorized signature, lifetime, key-bound scope and non-revocation",
  [variations],
  ([variation]) =>
    Effect.gen(function* verifyInviteProperty() {
      const sample = yield* fixture;

      const record = yield* Schema.decodeUnknownEffect(Invite.Main)({
        ...sample.invite.record,
        allowFleetOutbound: variation.allowOutbound,
        nonce: variation.nonce,
        ratePerMinute: variation.rate,
      });

      const invite = {
        keyId: issuerKeyId,
        record,
        signature: yield* sign(
          sample.host.keys.privateKey,
          signingBytes(record, issuerKeyId)
        ),
      };

      const scope = {
        handle: "ext/example/guest",
        recipient: "lobby",
        subject: record.subject,
        subjectKey: sample.fingerprint,
      };

      const permitted = testAuthority(sample.host.publicKey);

      const verified = yield* verifyInvite(invite, scope, now).pipe(
        Effect.provide(permitted)
      );

      expect(verified.ratePerMinute).toBe(variation.rate);
      expect(verified.allowFleetOutbound).toBe(variation.allowOutbound);

      const changed = { ...record, nonce: `${variation.nonce}!` };

      const forged = yield* verifyInvite(
        { ...invite, record: changed },
        scope,
        now
      ).pipe(Effect.provide(permitted), Effect.flip);

      expect(forged.reason).toBe("Invalid record signature");

      const expired = yield* verifyInvite(
        invite,
        scope,
        DateTime.toEpochMillis(DateTime.makeUnsafe(record.expiresAt))
      ).pipe(Effect.provide(permitted), Effect.flip);

      expect(expired.reason).toBe("Record is not currently valid");

      const future = yield* verifyInvite(
        invite,
        scope,
        DateTime.toEpochMillis(DateTime.makeUnsafe(record.createdAt)) - 1
      ).pipe(Effect.provide(permitted), Effect.flip);

      expect(future.reason).toBe("Record is not currently valid");

      for (const deniedScope of [
        { ...scope, recipient: "not-in-invite" },
        { ...scope, handle: "ext/elsewhere/guest" },
        { ...scope, subject: "did:web:other.example.invalid" },
        { ...scope, subjectKey: "0".repeat(64) },
      ]) {
        const decodedScope =
          yield* Schema.decodeUnknownEffect(InviteScope)(deniedScope);

        const denied = yield* verifyInvite(invite, decodedScope, now).pipe(
          Effect.provide(permitted),
          Effect.flip
        );

        expect(denied.reason).toBe("Invite is outside the requested scope");
      }

      const crypto = yield* Signatures;

      const revokedRecord = {
        ...sample.revocation.record,
        invite: yield* crypto.digest(signingBytes(record, issuerKeyId)),
      };

      const revocation = {
        keyId: issuerKeyId,
        record: revokedRecord,
        signature: yield* sign(
          sample.host.keys.privateKey,
          signingBytes(revokedRecord, issuerKeyId)
        ),
      };

      const revoked = yield* verifyInvite(invite, scope, now).pipe(
        Effect.provide(testAuthority(sample.host.publicKey, [revocation])),
        Effect.flip
      );

      expect(revoked.reason).toBe("Invite has been revoked");

      const untrusted = yield* verifyInvite(
        { ...invite, keyId: `${subject}#untrusted` },
        scope,
        now
      ).pipe(Effect.provide(permitted), Effect.flip);

      expect(untrusted).toBeInstanceOf(TrustFailure);
    }).pipe(Effect.provide(signatures)),
  { arbitrary: { runs: 30 } }
);

const IdentityCase = Schema.Struct({
  attestation: Schema.Literals([
    "none",
    "domain",
    "fleet",
    "wrong-key",
    "wrong-handle",
  ]),
  invite: Schema.Boolean,
});

it.effect.prop(
  "credentials cannot self-assert domain, vouch or fleet authority",
  [Arbitrary.schema(IdentityCase)],
  ([input]) =>
    Effect.gen(function* credentialAuthorityProperty() {
      const sample = yield* fixture;

      const attestation =
        input.attestation === "none"
          ? undefined
          : {
              atprotoHandle:
                input.attestation === "wrong-handle"
                  ? "other.example.invalid"
                  : sample.identity.record.atprotoHandle,
              fingerprint:
                input.attestation === "wrong-key"
                  ? "0".repeat(64)
                  : sample.fingerprint,
              handle: sample.identity.record.handle,
              subject,
              tier: input.attestation === "fleet" ? (4 as const) : (2 as const),
            };

      const directory = testAuthority(sample.host.publicKey, [], attestation);

      const result = yield* whoami(
        credential(sample, input.invite),
        "lobby",
        now
      ).pipe(Effect.provide(directory));

      let expected = input.attestation === "domain" ? 2 : 1;

      if (input.invite) {
        expected = 3;
      }

      if (input.attestation === "fleet") {
        expected = 4;
      }

      expect(result.tier).toBe(expected);
      expect(result.fingerprint).toBe(sample.fingerprint);
      expect(result.subject).toBe(
        input.attestation === "domain" || input.attestation === "fleet"
          ? subject
          : null
      );

      const absent = yield* whoami(undefined, "lobby", now).pipe(
        Effect.provide(directory)
      );

      expect(absent.tier).toBe(0);

      const expired = yield* whoami(
        credential(sample, input.invite),
        "lobby",
        now + 300_000
      ).pipe(Effect.provide(directory), Effect.flip);

      expect(expired.reason).toBe("Record is not currently valid");
    }).pipe(Effect.provide(signatures)),
  { arbitrary: { runs: 30 } }
);
