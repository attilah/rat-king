/* oxlint-disable promise/prefer-await-to-callbacks -- Effect HttpClient test adapter. */
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import * as Defs from "@rat-king/lexicon/defs";
import { layer, RatKingMailbox } from "@rat-king/mailbox-client";
import { Directory } from "@rat-king/ratking-client/directory";
import { PayloadJson } from "@rat-king/ratking-client/payload";
import { RatKing } from "@rat-king/ratking-client/ratking";
import { Threads, threadsLayer } from "@rat-king/ratking-client/threads";
import { Effect, FileSystem, Layer, Option, Predicate, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { expect } from "vitest";

import { document, identity } from "../../mailbox-client/test/identity.ts";
import { harness } from "./harness.ts";

it.live.prop(
  "a reply to an ask this reader never saw threads to the named asker",
  [Schema.Boolean, Schema.String],
  ([encrypt, body]) =>
    Effect.gen(function* recallProof() {
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();
      const envelopes: Defs.EncryptedEnvelopeValue[] = [];

      const http = HttpClient.make((request) =>
        Effect.gen(function* fakeMailbox() {
          if (
            !request.url.endsWith("sh.mschf.ratking.mailbox.send") ||
            !Predicate.isTagged(request.body, "Uint8Array")
          ) {
            return HttpClientResponse.fromWeb(
              request,
              Response.json({ error: "MailboxUnavailable" }, { status: 503 })
            );
          }

          const input = yield* Schema.decodeUnknownEffect(
            Schema.fromJsonString(
              Schema.Struct({ envelope: Defs.EncryptedEnvelope })
            )
          )(new TextDecoder().decode(request.body.body)).pipe(Effect.orDie);

          envelopes.push(input.envelope);

          return HttpClientResponse.fromWeb(
            request,
            Response.json({
              receipt: {
                message: {
                  messageId: input.envelope.aad.messageId,
                  senderDid: input.envelope.aad.senderDid,
                },
                recipientDid: input.envelope.aad.recipientDid,
                seq: envelopes.length,
                state: "accepted",
              },
            })
          );
        })
      );

      const asker = yield* identity("did:web:alice.agents.example.invalid");
      const original = "3m7x2ka4xv22a";

      yield* Effect.gen(function* proof() {
        const directory = yield* Directory;
        const ratking = yield* RatKing;

        yield* directory.record("alice", yield* document(asker));

        yield* ratking.run(
          {
            alive: () => false,
            env: Option.some("tester"),
            pane: Option.none(),
            pid: 1,
            reads: false,
            session: "recall-test",
          },
          () => Effect.void
        );

        const unnamed = yield* ratking
          .reply(original, body, { encrypt })
          .pipe(Effect.flip);

        expect(unnamed.code).toBe("NoSuchMessage");
        expect(envelopes).toHaveLength(0);

        const unknown = yield* ratking
          .reply(original, body, { encrypt, to: "missing" })
          .pipe(Effect.flip);

        expect(unknown.code).toBe("UnknownName");
        expect(envelopes).toHaveLength(0);

        const delivered = yield* ratking.reply(original, body, {
          encrypt,
          to: "alice",
        });

        expect(envelopes).toHaveLength(1);
        const [envelope] = envelopes;

        if (envelope === undefined) {
          throw new Error("Missing reply envelope");
        }

        expect(envelope.aad.messageId).toBe(delivered.id);
        expect(envelope.aad.recipientDid).toBe(asker.did);

        const mailboxLayer = layer({
          documents: yield* Schema.decodeUnknownEffect(
            Schema.Array(Schema.toType(Defs.DidDocument))
          )(yield* directory.documents),
          endpoint: "https://mailbox.example.invalid",
          identity: asker,
          serviceDid: "did:web:mailbox.example.invalid",
        });

        const opened = yield* RatKingMailbox.use((mailbox) =>
          mailbox.open(envelope)
        ).pipe(Effect.provide(mailboxLayer));

        expect(opened.replyTo).toEqual({
          messageId: original,
          senderDid: asker.did,
        });

        const payload = yield* Schema.decodeEffect(PayloadJson)(opened.body);

        expect(payload).toMatchObject({
          body,
          from: "tester",
          kind: "reply",
          reply: { parent: original, root: original },
          thread: original,
          to: "alice",
        });

        const threads = yield* Threads;
        const parent = "3m7x2ka4xv22b";

        yield* threads.remember({
          body,
          cc: false,
          did: asker.did,
          from: "alice",
          id: parent,
          kind: "reply",
          label: Option.none(),
          reply: { parent: original, root: original },
          replyTo: Option.some(original),
          summary: Option.none(),
          thread: "ignored-legacy-thread",
          verified: true,
        });

        yield* ratking.send("alice", body, {
          encrypt,
          replyTo: { messageId: parent, senderDid: asker.did },
        });

        const [, sentEnvelope] = envelopes;

        if (sentEnvelope === undefined) {
          throw new Error("Missing send reply envelope");
        }

        const sent = yield* RatKingMailbox.use((mailbox) =>
          mailbox.open(sentEnvelope)
        ).pipe(Effect.provide(mailboxLayer));

        const sentPayload = yield* Schema.decodeEffect(PayloadJson)(sent.body);

        expect(sentPayload.reply).toEqual({ parent, root: original });
        expect(sentPayload.replyTo).toBe(parent);

        yield* ratking.reply(parent, body, { encrypt });

        const replyEnvelope = envelopes.at(2);

        if (replyEnvelope === undefined) {
          throw new Error("Missing nested reply envelope");
        }

        const nested = yield* RatKingMailbox.use((mailbox) =>
          mailbox.open(replyEnvelope)
        ).pipe(Effect.provide(mailboxLayer));

        const nestedPayload = yield* Schema.decodeEffect(PayloadJson)(
          nested.body
        );

        expect(nestedPayload.reply).toEqual({ parent, root: original });
        expect(nestedPayload.thread).toBe(original);
      }).pipe(
        Effect.provide(
          harness(state, http).pipe(Layer.provideMerge(threadsLayer))
        )
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 4 }, timeout: 30_000 }
);
