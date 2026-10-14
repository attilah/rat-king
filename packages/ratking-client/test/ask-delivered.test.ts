import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Directory } from "@rat-king/ratking-client/directory";
import { RatKing } from "@rat-king/ratking-client/ratking";
import {
  Arbitrary,
  Effect,
  FileSystem,
  Layer,
  Option,
  Result,
  Schema,
} from "effect";
import { expect } from "vitest";

import { document, identity } from "../../mailbox-client/test/identity.ts";
import {
  fakeMailbox,
  quietSocket,
} from "../../pi-ratking/test/fake-mailbox.ts";
import { harness } from "../../pi-ratking/test/harness.ts";

const Case = Schema.Struct({
  accepted: Schema.Boolean,
  body: Schema.String.check(Schema.isPattern(/\S/u)),
});

it.live.prop(
  "onDelivered runs once, after the mailbox recorded the request, and never when the transmit is refused",
  [Arbitrary.schema(Case)],
  ([sample]) =>
    Effect.gen(function* deliveredHook() {
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();
      const mailbox = fakeMailbox(sample.accepted ? "accept" : "reject");
      const peer = yield* identity("did:web:peer.agents.example.invalid");
      const seenAtHook: number[] = [];

      yield* Effect.gen(function* proof() {
        const directory = yield* Directory;
        const ratking = yield* RatKing;

        yield* directory.record("peer", yield* document(peer));

        yield* ratking.run(
          {
            alive: () => false,
            env: Option.some("tester"),
            pane: Option.none(),
            pid: 1,
            session: "hook-test",
          },
          () => Effect.void
        );

        const asked = yield* ratking
          .ask("peer", sample.body, "1 second", {
            onDelivered: Effect.sync(() => {
              seenAtHook.push(mailbox.requests.length);
            }),
          })
          .pipe(Effect.result);

        expect(Result.isSuccess(asked)).toBe(sample.accepted);
        expect(seenAtHook).toEqual(sample.accepted ? [1] : []);
      }).pipe(
        Effect.provide(
          harness(state, mailbox.http).pipe(Layer.provideMerge(quietSocket))
        )
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 20 }, timeout: 120_000 }
);

it.live.prop(
  "a failing or defecting onDelivered never fails or alters the ask",
  [Arbitrary.schema(Schema.Literals(["fail", "die"]))],
  ([kind]) =>
    Effect.gen(function* isolatedHook() {
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();
      const mailbox = fakeMailbox("accept");
      const peer = yield* identity("did:web:peer.agents.example.invalid");

      yield* Effect.gen(function* proof() {
        const directory = yield* Directory;
        const ratking = yield* RatKing;

        yield* directory.record("peer", yield* document(peer));

        yield* ratking.run(
          {
            alive: () => false,
            env: Option.some("tester"),
            pane: Option.none(),
            pid: 1,
            session: "hook-test",
          },
          () => Effect.void
        );

        const asked = yield* ratking.ask("peer", "hi", "1 second", {
          onDelivered: Effect.die(kind),
        });

        expect(asked.reply).toBeUndefined();
        expect(mailbox.requests).toHaveLength(1);
      }).pipe(
        Effect.provide(
          harness(state, mailbox.http).pipe(Layer.provideMerge(quietSocket))
        )
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 4 }, timeout: 120_000 }
);

const Dispatched = Schema.Struct({
  ask: Schema.Boolean,
  known: Schema.Boolean,
});

it.live.prop(
  "onDispatch runs once immediately before the first request, never when the name is unknown",
  [Arbitrary.schema(Dispatched)],
  ([sample]) =>
    Effect.gen(function* dispatchHook() {
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();
      const mailbox = fakeMailbox("accept");
      const peer = yield* identity("did:web:peer.agents.example.invalid");
      const seenAtHook: number[] = [];

      yield* Effect.gen(function* proof() {
        const directory = yield* Directory;
        const ratking = yield* RatKing;

        yield* directory.record("peer", yield* document(peer));

        yield* ratking.run(
          {
            alive: () => false,
            env: Option.some("tester"),
            pane: Option.none(),
            pid: 1,
            session: "hook-test",
          },
          () => Effect.void
        );

        const options = {
          onDispatch: Effect.sync(() => {
            seenAtHook.push(mailbox.requests.length);
          }),
        };

        const to = sample.known ? "peer" : "nobody";

        yield* (
          sample.ask
            ? ratking.ask(to, "hi", "1 second", options).pipe(Effect.asVoid)
            : ratking.send(to, "hi", options).pipe(Effect.asVoid)
        ).pipe(Effect.result);

        expect(seenAtHook).toEqual(sample.known ? [0] : []);
        expect(mailbox.requests).toHaveLength(sample.known ? 1 : 0);
      }).pipe(
        Effect.provide(
          harness(state, mailbox.http).pipe(Layer.provideMerge(quietSocket))
        )
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 20 }, timeout: 120_000 }
);
