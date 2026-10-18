import { it } from "@effect/vitest";
import { MailboxHandlers } from "@rat-king/lexicon/mailbox-handlers";
import * as Send from "@rat-king/lexicon/mailbox.send";
import { Arbitrary, Effect, Layer, Schema } from "effect";
import { expect } from "vitest";

import { sealed, senderDid } from "../../../packages/envelope/test/helpers.ts";
import { staticResolver } from "../src/auth.ts";
import { Caller, handlersLayer } from "../src/mailbox.ts";
import { MailboxStore } from "../src/store.ts";
import { documents, testStore, unleasedSender } from "./helpers.ts";

it.effect.prop(
  "critical metadata survives SQL storage without changing admission or delivery events",
  [Arbitrary.schema(Schema.Boolean)],
  ([critical]) =>
    Effect.gen(function* metadata() {
      const sample = yield* sealed();

      const docs = yield* documents(
        sample.keys.sender.publicKey,
        sample.keys.recipient.publicKey
      );

      const storage = yield* testStore;
      const store = yield* MailboxStore.pipe(Effect.provide(storage.layer));

      const sender = yield* MailboxHandlers.pipe(
        Effect.provide(
          handlersLayer.pipe(
            Layer.provide(unleasedSender),
            Layer.provide(storage.layer),
            Layer.provide(staticResolver(docs)),
            Layer.provide(Layer.succeed(Caller, { did: senderDid }))
          )
        )
      );

      const input = yield* Schema.decodeUnknownEffect(
        Schema.toType(Send.Input)
      )({ critical, envelope: sample.envelope });

      const result = yield* sender.send(input);
      expect(result.receipt.state).toBe("accepted");
      expect(yield* sender.send(input)).toEqual(result);

      const stored = yield* store.transaction((tx) => ({
        events: tx.events(0, tx.watermark(), 10),
        message: tx.get(senderDid, sample.envelope.aad.messageId),
      }));

      expect(stored.message?.critical).toBe(critical);
      expect(stored.events).toHaveLength(1);
      expect(stored.events[0]).not.toHaveProperty("critical");
    }).pipe(Effect.scoped)
);
