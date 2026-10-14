import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import * as Wake from "@rat-king/lexicon/agentgraph.wake";
import * as Defs from "@rat-king/lexicon/defs";
import { Directory } from "@rat-king/ratking-client/directory";
import { LexiconRecord } from "@rat-king/ratking-client/payload";
import { Inbox, RatKing } from "@rat-king/ratking-client/ratking";
import type { NotDelivered } from "@rat-king/ratking-client/ratking";
import { Effect, FileSystem, Layer, Match, Schema } from "effect";
import { expect } from "vitest";

import { inbox } from "../../../packages/pi-ratking/src/pending.ts";
import { runAction } from "../../../packages/pi-ratking/src/tool.ts";
import { receiveWake } from "../../../packages/pi-ratking/src/wake-record.ts";
import { harness } from "../../../packages/pi-ratking/test/harness.ts";
import { fakeMailbox, people, seeded, socketLayer, TESTER } from "./fixture.ts";
import type { Mail } from "./fixture.ts";

const Word = Schema.String.check(Schema.isPattern(/^[a-z]{1,12}$/u));

const wake = (status: Wake.MainValue["status"], watch: string) => {
  const record = Schema.decodeUnknownSync(Wake.Main)({
    $type: "sh.mschf.agentgraph.wake",
    finishedAt: "2026-01-01T00:01:00Z",
    kind: "pane_output",
    label: "Worker",
    result: "Pane output intact",
    source: "herdr_watch",
    startedAt: "2026-01-01T00:00:00Z",
    status,
    text: "Watch settled",
    watch,
  });

  return Schema.decodeUnknownSync(LexiconRecord)(record);
};

const admittedMail = (envelope: Defs.EncryptedEnvelopeValue, seq: number) =>
  Schema.decodeUnknownSync(Schema.toType(Defs.MessageEvent))({
    $type: "sh.mschf.ratking.defs#messageEvent",
    envelope,
    receipt: {
      message: {
        messageId: envelope.aad.messageId,
        senderDid: envelope.aad.senderDid,
      },
      recipientDid: envelope.aad.recipientDid,
      seq,
      state: "accepted",
    },
    seq,
  });

it.live.prop(
  "signed self wake crosses transmit and the real reader: busy Next holds, idle flushes, cancellation settles held custody",
  [Word],
  ([watch]) =>
    Effect.gen(function* selfWake() {
      const fs = yield* FileSystem.FileSystem;
      const who = yield* people;
      const mails: Mail[] = [];
      const fake = fakeMailbox(mails);
      const state = yield* fs.makeTempDirectoryScoped();

      yield* Effect.gen(function* roundTrip() {
        const client = yield* RatKing;
        const reader = yield* Inbox;

        yield* reader.attach("tester");

        const first = yield* client.send(
          "tester",
          wake("matched", `${watch}-idle`),
          { encrypt: false }
        );

        const held = yield* client.send(
          "tester",
          wake("matched", `${watch}-cancel`),
          { encrypt: false }
        );

        const cancelled = yield* client.send(
          "tester",
          wake("cancelled", `${watch}-cancel`),
          { encrypt: false }
        );

        expect(fake.sends).toHaveLength(3);

        for (const [index, envelope] of fake.sends.entries()) {
          expect(envelope.aad.senderDid).toBe(TESTER);
          expect(envelope.aad.recipientDid).toBe(TESTER);
          mails.push({
            event: admittedMail(envelope, index + 1),
            state: "accepted",
          });
        }

        const shown: string[] = [];
        const settled: string[] = [];
        const acks = new Map<string, Effect.Effect<void, NotDelivered>>();

        const box = inbox({
          digest: (batch) => {
            shown.push(...batch.map((entry) => entry.id));
          },
          show: () => {
            throw new Error("Matched wake must wait for idle");
          },
        });

        const consume = (id: string) => {
          settled.push(id);
        };

        const flushAcks = Effect.suspend(() =>
          Effect.forEach(
            settled.splice(0),
            (id) => {
              const ack = acks.get(id);
              expect(ack).toBeDefined();

              return ack ?? Effect.die("Missing custody ack");
            },
            { discard: true }
          )
        );

        yield* reader.hold(
          (entry, ack) =>
            Effect.sync(() => {
              const inbound = entry.received;
              expect("record" in inbound).toBe(true);
              expect(inbound.verified).toBe(true);
              expect(inbound.from).toBe("tester");
              acks.set(inbound.id, ack);

              if ("record" in inbound) {
                receiveWake(
                  {
                    consume,
                    take: (pending, level) => {
                      expect(level).toBe("nextTurn");
                      expect(pending.details).toMatchObject({
                        wake: { result: "Pane output intact" },
                      });
                      box.take(pending, level);
                    },
                    withdraw: box.withdraw,
                  },
                  inbound,
                  false,
                  0
                );
              }

              expect(shown).toEqual([]);
            }),
          { afterSeq: 0, session: "self-wake-reader" }
        );

        expect(settled).toEqual([held.id, cancelled.id]);
        expect(mails.map((entry) => entry.state)).toEqual([
          "delivered",
          "delivered",
          "delivered",
        ]);
        yield* flushAcks;
        expect(mails.map((entry) => entry.state)).toEqual([
          "delivered",
          "acked",
          "acked",
        ]);
        box.flushNext();
        expect(shown).toEqual([first.id]);
        expect(mails[0]?.state).toBe("delivered");
        box.shown(first.id);
        consume(first.id);
        yield* flushAcks;
        expect(mails.map((entry) => entry.state)).toEqual([
          "acked",
          "acked",
          "acked",
        ]);
      }).pipe(
        Effect.provide(
          harness(state, fake.http, [], { secrets: seeded(who) }).pipe(
            Layer.provideMerge(socketLayer)
          )
        )
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 10 }, timeout: 120_000 }
);

it.live.prop(
  "every other self-send still refuses Self, including encoded or invalid wake records and same-DID aliases",
  [
    Word,
    Schema.Literals([
      "text",
      "encodedWake",
      "malformedWake",
      "otherRecord",
      "alias",
    ]),
  ],
  ([text, kind]) =>
    Effect.gen(function* selfRefusal() {
      const fs = yield* FileSystem.FileSystem;
      const who = yield* people;
      const fake = fakeMailbox([]);
      const state = yield* fs.makeTempDirectoryScoped();

      yield* Effect.gen(function* refusal() {
        const reader = yield* Inbox;
        const client = yield* RatKing;
        const directory = yield* Directory;

        yield* reader.attach("tester");
        yield* directory.record("alias", who.testerDocument);

        const plain = yield* client
          .send("tester", text, { encrypt: false })
          .pipe(Effect.result);

        expect(plain).toMatchObject({ failure: { code: "Self" } });

        const body = Match.value(kind).pipe(
          Match.when("alias", () => wake("matched", text)),
          Match.when("encodedWake", () =>
            JSON.stringify(wake("matched", text))
          ),
          Match.when("malformedWake", () => ({
            $type: "sh.mschf.agentgraph.wake",
            text,
          })),
          Match.when("otherRecord", () => ({
            $type: "sh.example.other",
            text,
          })),
          Match.orElse(() => text)
        );

        const result = yield* client
          .send(kind === "alias" ? "alias" : "tester", body, { encrypt: false })
          .pipe(Effect.result);

        expect(result).toMatchObject({ failure: { code: "Self" } });
        expect(fake.sends).toEqual([]);
      }).pipe(
        Effect.provide(harness(state, fake.http, [], { secrets: seeded(who) }))
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 20 }, timeout: 120_000 }
);

it.live.prop(
  "the record tool admits wake types and sends a typed self record that the same reader decodes",
  [Word, Schema.Literals(["matched", "cancelled"])],
  ([watch, status]) =>
    Effect.gen(function* recordTool() {
      const fs = yield* FileSystem.FileSystem;
      const who = yield* people;
      const mails: Mail[] = [];
      const fake = fakeMailbox(mails);
      const state = yield* fs.makeTempDirectoryScoped();

      yield* Effect.gen(function* toolRoundTrip() {
        const reader = yield* Inbox;

        yield* reader.attach("tester");

        const result = yield* runAction("ratking", "10 minutes", {
          action: "record",
          encrypt: false,
          record: wake(status, watch),
          to: "tester",
          type: "sh.mschf.agentgraph.wake",
        });

        expect(result.isError).toBe(false);
        expect(fake.sends).toHaveLength(1);

        for (const envelope of fake.sends) {
          mails.push({ event: admittedMail(envelope, 1), state: "accepted" });
        }

        const received: string[] = [];

        yield* reader.hold(
          (entry, ack) =>
            Effect.gen(function* toolReader() {
              expect(entry.received).toMatchObject({
                from: "tester",
                record: { $type: "sh.mschf.agentgraph.wake", status, watch },
                verified: true,
              });
              received.push(entry.received.id);
              yield* ack;
            }),
          { afterSeq: 0, session: "self-wake-tool" }
        );
        expect(received).toHaveLength(1);
        expect(mails[0]?.state).toBe("acked");
      }).pipe(
        Effect.provide(
          harness(state, fake.http, [], { secrets: seeded(who) }).pipe(
            Layer.provideMerge(socketLayer)
          )
        )
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 10 }, timeout: 120_000 }
);
