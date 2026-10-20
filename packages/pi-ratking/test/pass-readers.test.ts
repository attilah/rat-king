import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { plaintextSuite, seal } from "@rat-king/envelope";
import * as Defs from "@rat-king/lexicon/defs";
import { signingKey } from "@rat-king/lexicon/pass-webcrypto";
import { encodeDidKey, signPass } from "@rat-king/lexicon/passes";
import { PublicKey } from "@rat-king/lexicon/trust";
import { RatKingMailbox, importSigning, layer } from "@rat-king/mailbox-client";
import { Directory } from "@rat-king/ratking-client/directory";
import { PayloadJson, renderInbound } from "@rat-king/ratking-client/payload";
import { Inbox, RatKing } from "@rat-king/ratking-client/ratking";
import { relayedInbound, relayRecord } from "@rat-king/ratking-client/relay";
import {
  DateTime,
  Effect,
  FileSystem,
  Option,
  Predicate,
  Schema,
} from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { expect } from "vitest";

import { document, identity } from "../../mailbox-client/test/identity.ts";
import { inboundDetails } from "../src/extension.ts";
import { messageView } from "../src/message-view.ts";
import { harness } from "./harness.ts";
import { plainTheme } from "./view-arbitraries.ts";

it.live.prop(
  "a verified pass displays its desk and run in both readers and relays, while replies route to the desk but reference the worker",
  [Defs.PassRun, Schema.Boolean],
  ([run, delegated]) =>
    Effect.gen(function* proof() {
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();
      const events: Defs.MessageEventValue[] = [];
      const envelopes: Defs.EncryptedEnvelopeValue[] = [];

      const http = HttpClient.make((request) =>
        Effect.gen(function* fakeMailbox() {
          if (request.url.includes("sh.mschf.ratking.mailbox.list")) {
            return HttpClientResponse.fromWeb(
              request,
              Response.json({
                events: yield* Schema.encodeEffect(
                  Schema.Array(Defs.MessageEvent)
                )(events).pipe(Effect.orDie),
                throughSeq: 1,
              })
            );
          }

          if (
            request.url.endsWith("sh.mschf.ratking.mailbox.send") &&
            Predicate.isTagged(request.body, "Uint8Array")
          ) {
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
          }

          return HttpClientResponse.fromWeb(
            request,
            Response.json({ error: "MailboxUnavailable" }, { status: 503 })
          );
        })
      );

      yield* Effect.gen(function* readAndReply() {
        const directory = yield* Directory;
        const ratking = yield* RatKing;
        const desk = yield* identity("did:web:desk.agents.example.invalid");
        const worker = yield* identity("did:web:unused.example.invalid");

        const workerDid = yield* encodeDidKey(
          yield* Schema.decodeUnknownEffect(PublicKey)(worker.signing)
        );

        const workerKey = yield* importSigning(worker);
        yield* directory.record("desk", yield* document(desk));
        yield* ratking.run(
          {
            alive: () => false,
            env: Option.some("tester"),
            pane: Option.none(),
            pid: 1,
            reads: false,
            session: "pass-readers",
          },
          () => Effect.void
        );
        const own = { did: "did:web:tester.agents.example.invalid" };
        const now = 1_900_000_000;

        const pass = yield* signPass(
          signingKey(
            yield* Schema.decodeUnknownEffect(PublicKey)(desk.signing),
            yield* importSigning(desk)
          ),
          {
            $type: "sh.ratking.pass",
            desk: "desk",
            deskDid: desk.did,
            exp: now + 600,
            iat: now,
            nonce: "invented-nonce",
            run,
            scope: ["rk.send.plain"],
            v: 1,
            worker: workerDid,
          }
        );

        const originalId = "3mxcx45mn7sea";

        const recipientDid = delegated
          ? "did:web:original.agents.example.invalid"
          : own.did;

        const payload = yield* Schema.decodeUnknownEffect(
          Schema.toType(Defs.SigningPayload)
        )({
          aad: {
            messageId: originalId,
            recipientDid,
            recipientKeyId: `${recipientDid}#encryption`,
            senderDid: workerDid,
          },
          body: new TextEncoder().encode(
            JSON.stringify({
              body: "Worker content",
              from: "desk",
              kind: "message",
              to: delegated ? "original" : "tester",
            })
          ),
          suite: plaintextSuite,
          version: 1,
        });

        const envelope = yield* seal({
          payload,
          recipientKey: workerKey,
          recipientKeyId: `${recipientDid}#encryption`,
          signingKey: workerKey,
          signingKeyId: `${workerDid}#${workerDid.slice("did:key:".length)}`,
        });

        const rawReceipt = {
          message: {
            messageId: delegated ? "3mxcx45mn7seb" : originalId,
            senderDid: workerDid,
          },
          recipientDid: own.did,
          recordedAt: DateTime.formatIso(DateTime.makeUnsafe(now * 1000)),
          seq: 1,
          state: "accepted",
          via: {
            desk: "desk",
            deskDid: desk.did,
            pass,
            run,
            worker: workerDid,
          },
        };

        if (delegated) {
          Object.assign(rawReceipt, { delegatedFor: "original", originalId });
        }

        const receipt = yield* Schema.decodeUnknownEffect(Defs.Receipt)(
          rawReceipt
        );

        events.push(
          yield* Schema.decodeUnknownEffect(Schema.toType(Defs.MessageEvent))({
            $type: "sh.mschf.ratking.defs#messageEvent",
            envelope,
            receipt,
            seq: 1,
          })
        );
        const inbox = yield* Inbox;
        const peeked = yield* inbox.peek({ all: true });
        expect(peeked.unreadable).toEqual([]);
        const received = peeked.messages[0]?.received;

        if (received === undefined || !("body" in received)) {
          throw new Error("Missing inbound pass message");
        }

        expect(received.from).toBe("desk");
        expect(received.did).toBe(workerDid);
        expect(received.verified).toBe(true);
        expect(received.via).toEqual({ desk: "desk", deskDid: desk.did, run });
        const [label, id = ""] = run.split(":");
        const marker = `↳ via headless Pi ${label} (${id.slice(0, 8)})`;
        expect(renderInbound("ratking", received)).toContain(marker);
        expect(
          renderInbound("ratking", relayedInbound(relayRecord(received, false)))
        ).toContain(marker);
        expect(
          messageView({
            details: inboundDetails(received, false),
            expanded: true,
            theme: plainTheme,
            tool: "ratking",
          })
            ?.render(200)
            .join("\n")
        ).toContain(marker);
        yield* ratking.reply(receipt.message.messageId, "Reply content", {
          replyAll: false,
        });
        const [reply] = envelopes;

        if (reply === undefined) {
          throw new Error("Missing reply envelope");
        }

        expect(reply.aad.recipientDid).toBe(desk.did);

        const opened = yield* RatKingMailbox.use((mailbox) =>
          mailbox.open(reply)
        ).pipe(
          Effect.provide(
            layer({
              documents: yield* Schema.decodeUnknownEffect(
                Schema.Array(Schema.toType(Defs.DidDocument))
              )(yield* directory.documents),
              endpoint: "https://mailbox.example.invalid",
              identity: desk,
              serviceDid: "did:web:mailbox.example.invalid",
            })
          )
        );

        expect(opened.replyTo).toEqual({
          messageId: originalId,
          senderDid: workerDid,
        });
        expect(
          (yield* Schema.decodeUnknownEffect(PayloadJson)(opened.body)).to
        ).toBe("desk");
      }).pipe(Effect.provide(harness(state, http)));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 4 }, timeout: 30_000 }
);
