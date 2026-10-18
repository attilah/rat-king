import { it } from "@effect/vitest";
import * as Defs from "@rat-king/lexicon/defs";
import { Effect, Result, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { expect } from "vitest";

import { ownIdentity, prepare } from "../src/prepare.ts";
import { document, identity } from "./identity.ts";

it.effect.prop(
  "delegated plaintext verifies unchanged signatures but custody uses the copy id; wrong routing metadata and encrypted copies are refused",
  [Schema.Boolean],
  ([encrypted]) =>
    Effect.gen(function* proof() {
      const sender = yield* identity("did:web:sender.example.invalid");
      const desk = yield* identity("did:web:desk.example.invalid");
      const delegate = yield* identity("did:web:delegate.example.invalid");

      const source = yield* prepare({
        endpoint: "https://mailbox.example.invalid",
        own: yield* ownIdentity(sender),
        peers: [yield* document(desk)],
        serviceDid: "did:web:service.example.invalid",
      });

      const target = yield* prepare({
        endpoint: "https://mailbox.example.invalid",
        own: yield* ownIdentity(delegate),
        peers: [yield* document(sender), yield* document(desk)],
        serviceDid: "did:web:service.example.invalid",
      });

      const envelope = yield* source.seal(
        desk.did,
        JSON.stringify({
          body: "Invented",
          from: "alpha/sender",
          kind: "message",
          to: "alpha/desk",
        }),
        { encrypt: encrypted }
      );

      const receipt = yield* Schema.decodeUnknownEffect(Defs.Receipt)({
        delegatedFor: "alpha/desk",
        message: { messageId: "3mxcx45mn7sex", senderDid: sender.did },
        originalId: envelope.aad.messageId,
        recipientDid: delegate.did,
        seq: 1,
        state: "accepted",
      });

      const result = yield* target.mailbox
        .open(envelope, receipt)
        .pipe(Effect.result);

      expect(result._tag).toBe(encrypted ? "Failure" : "Success");

      if (Result.isSuccess(result)) {
        expect(result.success.tid).toBe(receipt.message.messageId);
        expect(result.success.originalId).toBe(envelope.aad.messageId);
        expect(result.success.delegatedFor).toBe("alpha/desk");
      }

      const bad = yield* target.mailbox
        .open(envelope, { ...receipt, delegatedFor: "alpha/wrong" })
        .pipe(Effect.result);

      expect(bad._tag).toBe("Failure");
    }).pipe(Effect.provide(FetchHttpClient.layer))
);
