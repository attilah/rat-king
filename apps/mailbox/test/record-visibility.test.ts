import { it } from "@effect/vitest";
import * as Presence from "@rat-king/lexicon/mailbox.getPresence";
import * as Acquire from "@rat-king/lexicon/runtime.acquireLease";
import * as Renew from "@rat-king/lexicon/runtime.renewLease";
import { Arbitrary, Clock, DateTime, Effect, Layer, Schema } from "effect";
import { expect } from "vitest";

import { recipientDid } from "../../../packages/envelope/test/helpers.ts";
import { LeaseAuthority, leaseLayer } from "../src/lease.ts";
import { presenceOf } from "../src/retirement.ts";
import { MailboxStore } from "../src/store.ts";
import { testStore } from "./helpers.ts";

it.effect.prop(
  "render declarations persist through acquire and renewal; old and released holders omit them",
  [Arbitrary.schema(Schema.Boolean)],
  ([declares]) =>
    Effect.gen(function* roundTrip() {
      const adapter = yield* testStore;
      yield* Effect.gen(function* proof() {
        const leases = yield* LeaseAuthority;
        const store = yield* MailboxStore;
        const now = yield* Clock.currentTimeMillis;

        const expiresAt = DateTime.formatIso(
          DateTime.makeUnsafe(now + 300_000)
        );

        const renders = ["sh.example.record.*"];

        const input = {
          did: recipientDid,
          expiresAt,
          harness: {
            $type: "sh.mschf.ratking.runtime.lease#pi",
            sessionId: "test-session",
          },
        };

        if (declares) {
          Object.assign(input, { renders });
        }

        const lease = yield* leases.acquire(
          yield* Schema.decodeUnknownEffect(Acquire.Input)(input)
        );

        const presence = () =>
          store.transaction((tx) => presenceOf(tx.lease(), now));

        const acquired = yield* presence();
        expect(acquired.renders).toEqual(declares ? renders : undefined);

        const encoded = yield* Schema.decodeUnknownEffect(Presence.Output)({
          did: recipientDid,
          ...acquired,
          lastHeldAt: expiresAt,
        });

        expect(encoded.renders).toEqual(declares ? renders : undefined);
        yield* leases.renew(
          yield* Schema.decodeUnknownEffect(Renew.Input)({
            did: recipientDid,
            expiresAt,
            generation: lease.generation,
            leaseId: lease.leaseId,
          })
        );
        expect((yield* presence()).renders).toEqual(
          declares ? renders : undefined
        );
        const changed = ["sh.example.next.*"];
        yield* leases.renew(
          yield* Schema.decodeUnknownEffect(Renew.Input)({
            did: recipientDid,
            expiresAt,
            generation: lease.generation,
            leaseId: lease.leaseId,
            renders: changed,
          })
        );
        expect((yield* presence()).renders).toEqual(changed);
        yield* leases.release({
          did: lease.did,
          generation: lease.generation,
          leaseId: lease.leaseId,
        });
        expect((yield* presence()).renders).toBeUndefined();
      }).pipe(
        Effect.provide(leaseLayer.pipe(Layer.provideMerge(adapter.layer)))
      );
    }).pipe(Effect.scoped)
);
