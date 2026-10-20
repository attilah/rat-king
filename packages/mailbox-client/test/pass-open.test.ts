import { it } from "@effect/vitest";
import { plaintextSuite, seal } from "@rat-king/envelope";
import * as Defs from "@rat-king/lexicon/defs";
import { signingKey } from "@rat-king/lexicon/pass-webcrypto";
import { encodeDidKey, signPass } from "@rat-king/lexicon/passes";
import { PublicKey } from "@rat-king/lexicon/trust";
import { DateTime, Effect, Result, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { expect } from "vitest";

import { importSigning } from "../src/identity.ts";
import { PayloadJson } from "../src/payload.ts";
import { ownIdentity, prepare } from "../src/prepare.ts";
import { document, identity } from "./identity.ts";

const Sample = Schema.Struct({
  body: Schema.String,
  delegated: Schema.Boolean,
  now: Schema.Int.check(
    Schema.isBetween({ maximum: 2_000_000_000, minimum: 1000 })
  ),
  run: Defs.PassRun,
});

it.effect.prop(
  "pass readers open signed worker envelopes at admission time, retain delegated custody, and refuse forged bindings, invalid runs, missing scope and bare did:key senders",
  [Sample],
  ([sample]) =>
    Effect.gen(function* proof() {
      const desk = yield* identity("did:web:desk.example.invalid");
      const worker = yield* identity("did:web:unused.example.invalid");
      const recipient = yield* identity("did:web:recipient.example.invalid");
      const delegate = yield* identity("did:web:delegate.example.invalid");

      const publicKey = yield* Schema.decodeUnknownEffect(PublicKey)(
        worker.signing
      );

      const workerDid = yield* encodeDidKey(publicKey);
      const workerKey = yield* importSigning(worker);

      const deskSigner = signingKey(
        yield* Schema.decodeUnknownEffect(PublicKey)(desk.signing),
        yield* importSigning(desk)
      );

      const recipientDocument = yield* document(recipient);

      const reader = yield* prepare({
        endpoint: "https://mailbox.example.invalid",
        own: yield* ownIdentity(sample.delegated ? delegate : recipient),
        peers: [yield* document(desk), recipientDocument],
        serviceDid: "did:web:service.example.invalid",
      });

      const payload = yield* Schema.decodeUnknownEffect(
        Schema.toType(Defs.SigningPayload)
      )({
        aad: {
          messageId: "3mxcx45mn7sea",
          recipientDid: recipient.did,
          recipientKeyId: `${recipient.did}#encryption`,
          senderDid: workerDid,
        },
        body: new TextEncoder().encode(
          JSON.stringify({
            body: sample.body,
            from: "alpha/desk",
            kind: "message",
            to: "alpha/recipient",
          })
        ),
        suite: plaintextSuite,
        version: 1,
      });

      const envelope = yield* seal({
        payload,
        recipientKey: workerKey,
        recipientKeyId: `${recipient.did}#encryption`,
        signingKey: workerKey,
        signingKeyId: `${workerDid}#${workerDid.slice("did:key:".length)}`,
      });

      const record = {
        $type: "sh.ratking.pass",
        desk: "alpha/desk",
        deskDid: desk.did,
        exp: sample.now + 600,
        iat: sample.now,
        nonce: "invented-nonce",
        run: sample.run,
        scope: ["rk.send.plain"],
        v: 1,
        worker: workerDid,
      };

      const pass = yield* signPass(deskSigner, record);

      const via = yield* Schema.decodeUnknownEffect(Defs.Via)({
        desk: record.desk,
        deskDid: desk.did,
        pass,
        run: sample.run,
        worker: workerDid,
      });

      const rawReceipt = {
        message: {
          messageId: sample.delegated ? "3mxcx45mn7seb" : payload.aad.messageId,
          senderDid: workerDid,
        },
        recipientDid: sample.delegated ? delegate.did : recipient.did,
        recordedAt: DateTime.formatIso(DateTime.makeUnsafe(sample.now * 1000)),
        seq: 1,
        state: "accepted",
        via,
      };

      if (sample.delegated) {
        Object.assign(rawReceipt, {
          delegatedFor: "alpha/recipient",
          originalId: payload.aad.messageId,
        });
      }

      const receipt = yield* Schema.decodeUnknownEffect(Defs.Receipt)(
        rawReceipt
      );

      const opened = yield* reader.mailbox.open(envelope, receipt);
      expect(opened.via).toEqual({
        desk: via.desk,
        deskDid: via.deskDid,
        run: via.run,
      });
      expect(opened.senderDid).toBe(workerDid);
      expect(opened.tid).toBe(receipt.message.messageId);
      expect(
        (yield* Schema.decodeUnknownEffect(PayloadJson)(opened.body)).body
      ).toBe(sample.body);
      expect(opened.originalId).toBe(
        sample.delegated ? payload.aad.messageId : undefined
      );

      const forged = yield* signPass(signingKey(publicKey, workerKey), record);

      const otherDesk = yield* signPass(deskSigner, {
        ...record,
        desk: "alpha/other",
      });

      const noScope = yield* signPass(deskSigner, {
        ...record,
        scope: ["sh.secretcell.fetch"],
      });

      const otherRun = yield* signPass(deskSigner, {
        ...record,
        run: "other:0123456789abcdef0123456789abcdef",
      });

      const otherWorker = yield* signPass(deskSigner, {
        ...record,
        worker: yield* encodeDidKey(
          yield* Schema.decodeUnknownEffect(PublicKey)(recipient.signing)
        ),
      });

      const expired = yield* Schema.decodeUnknownEffect(Defs.Receipt)({
        ...receipt,
        recordedAt: DateTime.formatIso(
          DateTime.makeUnsafe((sample.now + 661) * 1000)
        ),
      });

      const plants = [
        expired,
        { ...receipt, via: { ...via, pass: forged } },
        { ...receipt, via: { ...via, worker: receipt.recipientDid } },
        { ...receipt, via: { ...via, pass: otherDesk } },
        { ...receipt, via: { ...via, pass: noScope } },
        { ...receipt, via: { ...via, pass: otherRun } },
        { ...receipt, via: { ...via, pass: otherWorker } },
        { ...receipt, via: { ...via, run: "invalid" } },
        { ...receipt, via: { ...via, desk: "alpha/other" } },
        {
          ...receipt,
          message: { ...receipt.message, senderDid: receipt.recipientDid },
        },
      ];

      for (const plant of plants) {
        const result = yield* reader.mailbox
          .open(envelope, plant)
          .pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
      }

      const { via: omittedVia, ...bare } = receipt;
      expect(omittedVia).toBeDefined();
      expect(
        Result.isFailure(
          yield* reader.mailbox.open(envelope, bare).pipe(Effect.result)
        )
      ).toBe(true);
      const { recordedAt: omittedTime, ...untimed } = receipt;
      expect(omittedTime).toBeDefined();
      expect(
        Result.isFailure(
          yield* reader.mailbox.open(envelope, untimed).pipe(Effect.result)
        )
      ).toBe(true);
    }).pipe(Effect.provide(FetchHttpClient.layer))
);
