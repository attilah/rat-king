import { it } from "@effect/vitest";
import { MailboxHandlers } from "@rat-king/lexicon/mailbox-handlers";
import * as Health from "@rat-king/lexicon/mailbox.nameHealth";
import * as Acquire from "@rat-king/lexicon/runtime.acquireLease";
import { Clock, DateTime, Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import {
  sealed,
  recipientDid,
  senderDid,
} from "../../../packages/envelope/test/helpers.ts";
import { wakeIntent } from "../../../packages/mailbox-client/src/payload.ts";
import { staticResolver } from "../src/auth.ts";
import {
  Caller,
  handlersLayer,
  LeaseAuthority,
  leaseLayer,
} from "../src/mailbox.ts";
import { nameHealth } from "../src/name-health.ts";
import { documents, testStore, unleasedSender } from "./helpers.ts";

const Inputs = Schema.Struct({
  declared: Schema.Boolean,
  kind: Schema.Literals(["message", "data"]),
  primary: Schema.Boolean,
  quiet: Schema.Boolean,
});

const operator = "did:web:operator.example.invalid";

it.effect.prop(
  "encrypted routing intent survives admission and delivery; ack clears metadata without exposing content",
  [Inputs],
  ([input]) =>
    Effect.gen(function* proof() {
      const sample = yield* sealed();

      const docs = yield* documents(
        sample.keys.sender.publicKey,
        sample.keys.recipient.publicKey
      );

      const storage = yield* testStore;

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

      const recipient = yield* MailboxHandlers.pipe(
        Effect.provide(
          handlersLayer.pipe(
            Layer.provide(unleasedSender),
            Layer.provide(storage.layer),
            Layer.provide(staticResolver(docs)),
            Layer.provide(Layer.succeed(Caller, { did: recipientDid }))
          )
        )
      );

      const leases = yield* LeaseAuthority.pipe(
        Effect.provide(leaseLayer.pipe(Layer.provide(storage.layer)))
      );

      yield* TestClock.setTime(1_791_676_800_000);

      const intent = wakeIntent(input.kind, input.primary, input.quiet);

      const admitted = yield* sender.send(
        input.declared
          ? { envelope: sample.envelope, ...intent }
          : { envelope: sample.envelope }
      );

      expect(admitted.receipt.woke).toBe(
        input.declared ? intent.woke : undefined
      );
      expect(admitted.receipt.wakeReason).toBe(
        input.declared ? intent.wakeReason : undefined
      );

      const lease = yield* leases.acquire(
        yield* Schema.decodeUnknownEffect(Acquire.Input)({
          did: recipientDid,
          expiresAt: DateTime.formatIso(
            DateTime.makeUnsafe((yield* Clock.currentTimeMillis) + 600_000)
          ),
          harness: {
            $type: "sh.mschf.ratking.runtime.lease#pi",
            paneId: "test-pane",
            sessionId: "test-session",
          },
        })
      );

      const fence = {
        generation: lease.generation,
        leaseId: lease.leaseId,
        message: admitted.receipt.message,
        recipientDid: lease.did,
      };

      yield* recipient.deliver(fence);

      const params = yield* Schema.decodeUnknownEffect(Health.Params)({
        name: "recipient",
        recipientDid,
      });

      const before = yield* nameHealth(storage.sql, params, operator, [
        operator,
      ]);

      expect(before.complete).toBe(input.declared);
      expect(before.quietUnacked).toBe(
        input.declared && !intent.woke && input.kind !== "data" ? 1 : 0
      );
      expect(before.lease?.holder).toBe("test-session");
      expect(before.oldestWake?.id).toBe(
        input.declared && intent.woke
          ? admitted.receipt.message.messageId
          : undefined
      );
      expect(Object.keys(before).toSorted()).toEqual(
        input.declared && intent.woke
          ? ["complete", "lease", "oldestWake", "quietUnacked"]
          : ["complete", "lease", "quietUnacked"]
      );
      expect(Object.keys(before.lease ?? {}).toSorted()).toEqual([
        "expiresAt",
        "generation",
        "holder",
        "pane",
      ]);

      if (before.oldestWake !== undefined) {
        expect(Object.keys(before.oldestWake).toSorted()).toEqual([
          "id",
          "recordedAt",
          "sender",
          "woke",
        ]);
      }

      expect(JSON.stringify(before)).not.toContain("ciphertext");
      expect(Object.keys(Health.Output.schema.fields).toSorted()).toEqual([
        "complete",
        "lastAck",
        "lease",
        "oldestWake",
        "quietUnacked",
      ]);

      const denied = yield* nameHealth(storage.sql, params, recipientDid, [
        operator,
      ]).pipe(Effect.flip);

      expect(denied.error).toBe("Forbidden");

      yield* TestClock.adjust(181_000);
      yield* recipient.ack(fence);

      const after = yield* nameHealth(storage.sql, params, operator, [
        operator,
      ]);

      expect(after.oldestWake).toBeUndefined();
      expect(after.quietUnacked).toBe(0);
      expect(after.lastAck).toBe("2026-10-11T00:03:01.000Z");
      expect(after.lease).toEqual(before.lease);
    }).pipe(Effect.scoped)
);
