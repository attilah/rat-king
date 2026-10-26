import { it } from "@effect/vitest";
import { Effect, Layer, Schema, Stream } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import type { Socket } from "effect/socket";
import { expect } from "vitest";

import { POLL_MAX_PAGES } from "../src/mailbox.ts";
import { ownIdentity, prepare } from "../src/prepare.ts";
import { WebSocketPort } from "../src/watch.ts";
import { identity } from "./identity.ts";

it.effect.prop(
  "poll caps snapshot memory and watch drains continuation without another notice",
  [Schema.Int.check(Schema.isBetween({ maximum: 20, minimum: 1 }))],
  ([remaining]) =>
    Effect.gen(function* proof() {
      const own = yield* identity("did:web:reader.invalid");
      const total = POLL_MAX_PAGES * 100 + remaining;
      let offset = 0;
      let calls = 0;

      const http = HttpClient.make((request) =>
        Effect.sync(() => {
          calls += 1;
          const count = Math.min(100, total - offset);

          const events = Array.from({ length: count }, (_, index) => ({
            $type: "test.synthetic",
            seq: offset + index + 1,
          }));

          offset += count;

          const output = { events, throughSeq: total };

          if (offset < total) {
            Object.assign(output, { cursor: String(offset) });
          }

          return HttpClientResponse.fromWeb(request, Response.json(output));
        })
      );

      const client = yield* prepare({
        endpoint: "https://mailbox.invalid",
        own: yield* ownIdentity(own),
        peers: [],
        serviceDid: "did:web:service.invalid",
      }).pipe(Effect.provide(Layer.succeed(HttpClient.HttpClient, http)));

      const first = yield* client.mailbox.poll(0);
      expect(first.events).toHaveLength(POLL_MAX_PAGES * 100);
      expect(first.throughSeq).toBe(POLL_MAX_PAGES * 100);
      expect(first.hasMore).toBe(true);
      expect(calls).toBe(POLL_MAX_PAGES);
      const second = yield* client.mailbox.poll(first.throughSeq);
      expect(second.events).toHaveLength(remaining);
      expect(second.throughSeq).toBe(total);
      offset = 0;
      calls = 0;

      const listeners = new Map<
        string,
        (event: Socket.WebSocketEvent) => void
      >();

      const socket: Socket.WebSocketLike = {
        addEventListener: (type, listener) => {
          listeners.set(type, listener);
        },
        close: () => {
          listeners.clear();
        },
        readyState: 1,
        removeEventListener: (type) => {
          listeners.delete(type);
        },
        send: () => {
          listeners.get("message")?.({
            data: JSON.stringify({
              $type: "sh.mschf.ratking.mailbox.subscribe#notice",
              seq: total,
            }),
          });
        },
      };

      const batches = yield* client.mailbox
        .watch(0, { did: own.did, generation: 1, leaseId: "3mxcx45mn7sex" })
        .pipe(
          Stream.take(2),
          Stream.runCollect,
          Effect.provideService(WebSocketPort, { connect: () => socket })
        );

      expect(
        batches.flatMap((batch) => batch.events).map((event) => event.seq)
      ).toEqual(Array.from({ length: total }, (_, index) => index + 1));
      expect(calls).toBe(POLL_MAX_PAGES + 1);
    }),
  { arbitrary: { runs: 4 } }
);
