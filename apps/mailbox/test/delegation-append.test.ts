import { it } from "@effect/vitest";
import { plaintextSuite } from "@rat-king/envelope/canonical";
import { seal } from "@rat-king/envelope/envelope";
import * as AttentionStatus from "@rat-king/lexicon/attention.status";
import * as Defs from "@rat-king/lexicon/defs";
import { MailboxHandlers } from "@rat-king/lexicon/mailbox-handlers";
import * as Ack from "@rat-king/lexicon/mailbox.ack";
import * as Deliver from "@rat-king/lexicon/mailbox.deliver";
import { Arbitrary, Effect, Layer, Match, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import {
  recipientDid,
  sealed,
  senderDid,
} from "../../../packages/envelope/test/helpers.ts";
import { defaultStatus } from "../../../packages/mailbox-client/src/attention.ts";
import { PayloadJson } from "../../../packages/mailbox-client/src/payload.ts";
import { AttentionDirectory } from "../src/attention-directory.ts";
import { staticResolver } from "../src/auth.ts";
import {
  DelegationTransport,
  acceptDelegated,
  flushDelegations,
} from "../src/delegation.ts";
import { failure } from "../src/failure.ts";
import type { MailboxPolicy } from "../src/lease.ts";
import { Caller, mailboxHandlers } from "../src/mailbox.ts";
import { sqliteStore } from "../src/sqlite.ts";
import { MailboxStore } from "../src/store.ts";
import {
  documents,
  testStore,
  testStoreFor,
  unleasedSender,
} from "./helpers.ts";

const Case = Schema.Literals([
  "delegate",
  "available",
  "expired",
  "cycle",
  "critical",
  "ask",
  "reply",
  "cc",
  "operator",
  "encrypted",
  "exempt",
  "joel",
  "unavailable",
]);

it.effect.prop(
  "flagged append keeps custody, copies once, retries durably, protects every direct case, and flag off is identical",
  [Arbitrary.schema(Case)],
  ([kind]) =>
    Effect.gen(function* proof() {
      yield* TestClock.setTime(1000);
      const sample = yield* sealed();

      const docs = yield* documents(
        sample.keys.sender.publicKey,
        sample.keys.recipient.publicKey
      );

      const storage = yield* testStore;
      const store = yield* MailboxStore.pipe(Effect.provide(storage.layer));

      const delegateStorage = yield* testStoreFor(
        "did:web:delegate.example.invalid"
      );

      const delegateStore = yield* MailboxStore.pipe(
        Effect.provide(delegateStorage.layer)
      );

      const delegateDid = "did:web:delegate.example.invalid";

      const publicDocs = yield* Schema.decodeUnknownEffect(
        Schema.Array(Defs.DidDocument)
      )(docs);

      const payload = yield* Schema.encodeEffect(PayloadJson)({
        body: "Invented message",
        cc: ["alpha/cc"],
        from: kind === "joel" ? "joel" : "alpha/sender",
        kind: Match.value(kind).pipe(
          Match.when("ask", () => "ask" as const),
          Match.when("reply", () => "reply" as const),
          Match.orElse(() => "message" as const)
        ),
        thread: "3mxcx45mn7sex",
        to: kind === "cc" ? "alpha/other" : "alpha/desk",
      });

      const envelope = yield* seal({
        payload: yield* Schema.decodeUnknownEffect(
          Schema.toType(Defs.SigningPayload)
        )({
          aad: sample.envelope.aad,
          body: new TextEncoder().encode(payload),
          suite: kind === "encrypted" ? sample.envelope.suite : plaintextSuite,
          version: 1,
        }),
        recipientKey: sample.keys.recipient.publicKey,
        recipientKeyId: sample.envelope.aad.recipientKeyId,
        signingKey: sample.keys.sender.privateKey,
        signingKeyId: `${senderDid}#atproto`,
      });

      const status = yield* Schema.decodeUnknownEffect(AttentionStatus.Main)({
        ...defaultStatus(),
        delegate: "alpha/ea",
        exempt: kind === "exempt" ? ["alpha/sender"] : [],
        state: kind === "available" ? "available" : "busy",
        until:
          kind === "expired"
            ? "1970-01-01T00:00:01.000Z"
            : "1970-01-01T00:00:01.001Z",
      });

      yield* store.transaction((tx) => {
        tx.setAttentionStatus(status);
      });

      const directory = Layer.succeed(AttentionDirectory, {
        resolve: (name) =>
          kind === "unavailable"
            ? Effect.fail(failure("MailboxUnavailable", 503))
            : Effect.succeed(
                Option.fromUndefinedOr(
                  new Map([
                    ["alpha/desk", recipientDid],
                    ["alpha/ea", delegateDid],
                    ["alpha/sender", senderDid],
                    ["joel", senderDid],
                  ]).get(name)
                )
              ),
        status: () =>
          Effect.succeed(
            Schema.decodeUnknownSync(AttentionStatus.Main)({
              ...defaultStatus(),
              delegate: kind === "cycle" ? "alpha/desk" : "alpha/third",
              state: "busy",
            })
          ),
      });

      let attempts = 0;
      const copied: string[] = [];

      const transport = Layer.succeed(DelegationTransport, {
        append: (_did, copy) =>
          Effect.gen(function* appendCopy() {
            attempts += 1;

            yield* acceptDelegated(copy).pipe(
              Effect.provide(delegateStorage.layer)
            );

            if (attempts === 1) {
              return yield* failure("MailboxUnavailable", 503);
            }

            copied.push(copy.copyId);

            return yield* Effect.void;
          }),
      });

      const service = (enabled: boolean | undefined, layer = storage.layer) => {
        const policy: MailboxPolicy = {
          operators: kind === "operator" ? [senderDid] : [],
          resolvers: [],
          staticDocuments: publicDocs,
        };

        if (enabled !== undefined) {
          Object.assign(policy, { delegation: enabled });
        }

        return MailboxHandlers.pipe(
          Effect.provide(
            mailboxHandlers(policy).pipe(
              Layer.provide(unleasedSender),
              Layer.provide(layer),
              Layer.provide(staticResolver(docs)),
              Layer.provide(Layer.succeed(Caller, { did: senderDid })),
              Layer.provide(directory),
              Layer.provide(transport)
            )
          )
        );
      };

      const baselineStorage = yield* testStore;
      yield* MailboxStore.use((baseStore) =>
        baseStore.transaction((tx) => {
          tx.setAttentionStatus(status);
        })
      ).pipe(Effect.provide(baselineStorage.layer));
      const baseline = yield* service(false, baselineStorage.layer);

      const baselineReceipt = yield* baseline.send({
        critical: kind === "critical",
        envelope,
      });

      expect(baselineReceipt.receipt).not.toHaveProperty("delegated");
      const defaultStorage = yield* testStore;
      yield* MailboxStore.use((defaultStore) =>
        defaultStore.transaction((tx) => {
          tx.setAttentionStatus(status);
        })
      ).pipe(Effect.provide(defaultStorage.layer));
      const defaultSender = yield* service(undefined, defaultStorage.layer);
      expect(
        yield* defaultSender.send({ critical: kind === "critical", envelope })
      ).toEqual(baselineReceipt);

      const sender = yield* service(true);

      const receipt = yield* sender.send({
        critical: kind === "critical",
        envelope,
      });

      const pending = yield* store.transaction((tx) => tx.pendingDelegations());
      expect(pending).toHaveLength(kind === "delegate" ? 1 : 0);

      const firstFlush = yield* flushDelegations.pipe(
        Effect.provide(Layer.merge(storage.layer, transport)),
        Effect.result
      );

      expect(firstFlush._tag).toBe(kind === "delegate" ? "Failure" : "Success");

      const reopened = sqliteStore(storage.sql, recipientDid);
      yield* flushDelegations.pipe(
        Effect.provide(Layer.merge(reopened, transport))
      );

      const retry = yield* sender.send({
        critical: kind === "critical",
        envelope,
      });

      expect(retry).toEqual(receipt);
      yield* flushDelegations.pipe(
        Effect.provide(Layer.merge(storage.layer, transport))
      );

      const original = yield* store.transaction((tx) =>
        tx.get(senderDid, envelope.aad.messageId)
      );

      expect(original?.current.state).toBe("accepted");
      expect(original?.envelope).toEqual(envelope);

      if (kind === "delegate") {
        expect(receipt.receipt.delegated?.to).toBe("alpha/ea");
        expect(copied).toHaveLength(1);
        expect(original?.current.delegatedTo).toBe("alpha/ea");

        const copies = yield* delegateStore.transaction((tx) =>
          tx.events(0, tx.watermark(), 20)
        );

        expect(copies).toHaveLength(1);
        const [copy] = copies;
        expect(copy).toHaveProperty("receipt.delegatedFor", "alpha/desk");
        expect(copy).toHaveProperty(
          "receipt.originalId",
          envelope.aad.messageId
        );
        expect(copy).not.toHaveProperty(
          "receipt.message.messageId",
          envelope.aad.messageId
        );

        const copyEvent = yield* Schema.decodeUnknownEffect(
          Schema.toType(Defs.MessageEvent)
        )(copy);

        yield* delegateStore.transaction((tx) => {
          tx.setLease({
            expiresAt: 100_000,
            generation: 1,
            leaseId: "3mxcx45mn7sey",
          });
        });

        const delegate = yield* MailboxHandlers.pipe(
          Effect.provide(
            mailboxHandlers({
              operators: [],
              resolvers: [],
              staticDocuments: publicDocs,
            }).pipe(
              Layer.provide(unleasedSender),
              Layer.provide(delegateStorage.layer),
              Layer.provide(staticResolver(docs)),
              Layer.provide(Layer.succeed(Caller, { did: delegateDid }))
            )
          )
        );

        const custody = {
          generation: 1,
          leaseId: "3mxcx45mn7sey",
          message: copyEvent.receipt.message,
          recipientDid: delegateDid,
        };

        const delivered = yield* delegate.deliver(
          yield* Schema.decodeUnknownEffect(Deliver.Input)(custody)
        );

        expect(delivered.receipt.state).toBe("delivered");

        const acked = yield* delegate.ack(
          yield* Schema.decodeUnknownEffect(Ack.Input)(custody)
        );

        expect(acked.receipt.state).toBe("acked");

        const retained = yield* store.transaction((tx) =>
          tx.get(senderDid, envelope.aad.messageId)
        );

        expect(retained?.current.state).toBe("accepted");
        expect(retained?.delegationPending).toBeUndefined();
      } else {
        expect(receipt).toEqual(baselineReceipt);

        const baselineStore = yield* MailboxStore.pipe(
          Effect.provide(baselineStorage.layer)
        );

        const baseEvents = yield* baselineStore.transaction((tx) =>
          tx.events(0, tx.watermark(), 20)
        );

        const directEvents = yield* store.transaction((tx) =>
          tx.events(0, tx.watermark(), 20)
        );

        expect(directEvents).toEqual(baseEvents);
        expect(receipt.receipt).not.toHaveProperty("delegated");
        expect(copied).toHaveLength(0);
      }
    }).pipe(Effect.scoped),
  { arbitrary: { runs: 40 }, timeout: 30_000 }
);
