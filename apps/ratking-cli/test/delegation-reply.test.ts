import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import * as Defs from "@rat-king/lexicon/defs";
import { ownIdentity, prepare } from "@rat-king/mailbox-client";
import { Directory } from "@rat-king/ratking-client/directory";
import { renderInbound } from "@rat-king/ratking-client/payload";
import { Inbox, RatKing } from "@rat-king/ratking-client/ratking";
import { Arbitrary, Effect, FileSystem, Layer, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { expect } from "vitest";

import { plaintextBody } from "../../../packages/envelope/src/signed.ts";
import { PayloadJson } from "../../../packages/mailbox-client/src/payload.ts";
import {
  document,
  identity,
} from "../../../packages/mailbox-client/test/identity.ts";
import { digestLine } from "../../../packages/pi-ratking/src/extension.ts";
import { harness } from "../../../packages/pi-ratking/test/harness.ts";
import { fakeMailbox, people, seeded } from "./fixture.ts";

it.live.prop(
  "reply-all from a delegated copy reaches the original sender, desk and cc, and references the signed original id",
  [Arbitrary.schema(Schema.Boolean)],
  ([replyAll]) =>
    Effect.gen(function* proof() {
      const fs = yield* FileSystem.FileSystem;
      const who = yield* people;
      const cc = yield* identity("did:web:copycc.agents.example.invalid");
      const ccDoc = yield* document(cc);

      const source = yield* prepare({
        endpoint: "https://mailbox.example.invalid",
        own: yield* ownIdentity(who.peer),
        peers: [who.otherDocument],
        serviceDid: "did:web:service.example.invalid",
      });

      const envelope = yield* source.seal(
        who.other.did,
        yield* Schema.encodeEffect(PayloadJson)({
          body: "Invented delegated message",
          cc: ["copycc"],
          from: "peer",
          kind: "message",
          thread: "3mxcx45mn7sey",
          to: "other",
        }),
        { encrypt: false }
      );

      const event = yield* Schema.decodeUnknownEffect(
        Schema.toType(Defs.MessageEvent)
      )({
        $type: "sh.mschf.ratking.defs#messageEvent",
        envelope,
        receipt: {
          delegatedFor: "other",
          message: { messageId: "3mxcx45mn7sex", senderDid: who.peer.did },
          originalId: envelope.aad.messageId,
          recipientDid: who.tester.did,
          seq: 1,
          state: "accepted",
        },
        seq: 1,
      });

      const mailbox = fakeMailbox([{ event, state: "accepted" }]);

      const wiring = harness(
        yield* fs.makeTempDirectoryScoped(),
        mailbox.http,
        [],
        { secrets: seeded(who) }
      );

      yield* Effect.gen(function* reader() {
        const directory = yield* Directory;
        yield* directory.record("peer", who.peerDocument);
        yield* directory.record("other", who.otherDocument);
        yield* directory.record("copycc", ccDoc);
        const inbox = yield* Inbox;
        yield* inbox.attach("tester");
        const peek = yield* inbox.peek();
        expect(peek.unreadable).toEqual([]);
        const inbound = peek.messages[0]?.received;
        expect(inbound).toBeDefined();

        if (inbound === undefined || "record" in inbound) {
          return;
        }

        expect(renderInbound("ratking", inbound)).toContain("for other");
        expect(inbound.copy).toBe(false);
        expect(digestLine({ ...inbound, delegatedTo: "alpha/ea" })).toContain(
          "handled by alpha/ea"
        );
        const ratking = yield* RatKing;
        yield* ratking.reply(inbound.id, "Invented reply", { replyAll });
        expect(
          new Set(mailbox.sends.map((sent) => sent.aad.recipientDid))
        ).toEqual(
          new Set(
            replyAll ? [who.peer.did, who.other.did, cc.did] : [who.peer.did]
          )
        );

        for (const sent of mailbox.sends) {
          const payload = yield* Schema.decodeUnknownEffect(PayloadJson)(
            yield* plaintextBody(sent)
          );

          expect(payload.reply?.parent).toBe(envelope.aad.messageId);
          expect(payload.replyTo).toBe(envelope.aad.messageId);
          expect(payload.thread).toBe("3mxcx45mn7sey");
        }

        expect(
          mailbox.calls.filter((call) => call.nsid.endsWith("mailbox.ack"))
        ).toHaveLength(0);
      }).pipe(Effect.provide(wiring));
    }).pipe(
      Effect.scoped,
      Effect.provide(Layer.merge(NodeServices.layer, FetchHttpClient.layer))
    ),
  { arbitrary: { runs: 6 }, timeout: 30_000 }
);
