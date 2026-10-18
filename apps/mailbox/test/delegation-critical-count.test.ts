import { it } from "@effect/vitest";
import * as Traffic from "@rat-king/lexicon/mailbox.listTraffic";
import { Arbitrary, DateTime, Effect, Schema } from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import {
  appendTraffic,
  listTraffic,
  trafficDid,
  TrafficOutboxEntry,
} from "../src/traffic-store.ts";
import { testStoreFor } from "./helpers.ts";

it.effect.prop(
  "critical totals are idempotent and optional",
  [
    Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 20, minimum: 1 }))
    ),
  ],
  ([count]) =>
    Effect.gen(function* proof() {
      yield* TestClock.setTime(1000);
      const storage = yield* testStoreFor(trafficDid);

      const entries = yield* Effect.forEach(
        Array.from({ length: count }, (_, index) => index),
        (index) =>
          Schema.decodeUnknownEffect(TrafficOutboxEntry)({
            ciphertextSize: 100,
            critical: true,
            messageId: `3mxcx45mn7se${"234567abcdefghijklmnopqrstuvwxyz"[index]}`,
            recipientDid: "did:web:desk.example.invalid",
            recipientSeq: index + 1,
            senderDid: "did:web:sender.example.invalid",
            seq: index + 1,
            state: "accepted",
            time: "1970-01-01T00:00:01.000Z",
          })
      );

      appendTraffic(storage.sql, entries);
      appendTraffic(storage.sql, entries);

      const params = yield* Schema.decodeUnknownEffect(Traffic.Params)({
        limit: 50,
      });

      expect(listTraffic(storage.sql, params)).not.toHaveProperty(
        "criticalCounts"
      );
      expect(
        listTraffic(storage.sql, params, true, yield* DateTime.now)
          .criticalCounts
      ).toEqual([
        {
          count,
          day: "1970-01-01",
          senderDid: "did:web:sender.example.invalid",
        },
      ]);
      yield* TestClock.setTime(86_400_000);
      expect(
        listTraffic(storage.sql, params, true, yield* DateTime.now)
          .criticalCounts
      ).toEqual([]);
    }).pipe(Effect.scoped)
);
