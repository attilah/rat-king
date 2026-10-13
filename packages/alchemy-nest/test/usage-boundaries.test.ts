import { it } from "@effect/vitest";
import { Effect, Schema, Stream } from "effect";
import { expect } from "vitest";

import { decodeTrafficLine, usageDigest } from "../../../stacks/nest/usage.ts";

const accepted = {
  messageId: "fixture-message",
  recipientDid: "did:web:fixture.recipient.pi.fleet.invalid",
  recipientSeq: 1,
  senderDid: "did:web:fixture.sender.pi.fleet.invalid",
  seq: 1,
  state: "accepted",
  time: "2026-10-12T00:00:00Z",
};

it.effect.prop(
  "size values are discarded without validation or retention",
  [Schema.Unknown],
  ([size]) =>
    Effect.gen(function* discardedSize() {
      const event = yield* decodeTrafficLine(
        JSON.stringify({ ...accepted, ciphertextSize: size })
      );

      expect(event).toEqual(accepted);
    })
);

it.effect.prop(
  "invalid calendar days and non-UTC timestamps are refused",
  [
    Schema.Literals([
      "2026-02-30T00:00:00Z",
      "2026-10-12T24:00:00Z",
      "2026-10-12T00:00:00+00:00",
      "not-a-time",
    ]),
  ],
  ([time]) =>
    Effect.gen(function* timestampBoundary() {
      const error = yield* decodeTrafficLine(
        JSON.stringify({ ...accepted, time })
      ).pipe(Effect.flip);

      expect(error._tag).toBe("FleetError");
    })
);

it.effect.prop(
  "top ten senders rank by accepted events with names separate from DIDs",
  [Schema.Int.check(Schema.isBetween({ maximum: 20, minimum: 1 }))],
  ([count]) =>
    Effect.gen(function* senderRanking() {
      const events = Array.from({ length: count }, (_, index) =>
        Array.from({ length: index + 1 }, (_recipient, recipient) =>
          JSON.stringify({
            ...accepted,
            messageId: `message-${index}`,
            recipientDid: `recipient-${recipient}`,
            senderDid: `did:web:fixture.row${index}.pi.fleet.invalid`,
          })
        )
      ).flat();

      const digest = yield* usageDigest(
        "2026-10-12",
        Stream.fromIterable(events).pipe(Stream.mapEffect(decodeTrafficLine))
      );

      expect(digest.topSenders).toEqual(
        Array.from({ length: Math.min(10, count) }, (_, index) => ({
          count: count - index,
          did: `did:web:fixture.row${count - index - 1}.pi.fleet.invalid`,
          name: `fixture/row${count - index - 1}`,
        }))
      );
    })
);

it.effect(
  "a forbidden line after valid and future events refuses the whole stream",
  () =>
    Effect.gen(function* latePlant() {
      const error = yield* usageDigest(
        "2026-10-12",
        Stream.fromIterable([
          JSON.stringify(accepted),
          JSON.stringify({ ...accepted, time: "2026-10-13T00:00:00Z" }),
          JSON.stringify({
            ...accepted,
            body: "PRIVATE_VALUE",
            time: "2026-10-13T00:00:00Z",
          }),
        ]).pipe(Stream.mapEffect(decodeTrafficLine))
      ).pipe(Effect.flip);

      expect(error._tag).toBe("ForbiddenField");
      expect(JSON.stringify(error)).not.toContain("PRIVATE_VALUE");
    })
);
