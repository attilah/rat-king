// @effect-diagnostics asyncFunction:off -- Pi's extension API is the Promise boundary under test.
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import type { Inbound } from "@rat-king/ratking-client/payload";
import { RatKing } from "@rat-king/ratking-client/ratking";
import type { Deliver } from "@rat-king/ratking-client/ratking";
import {
  Arbitrary,
  Clock,
  Deferred,
  Effect,
  FileSystem,
  Layer,
  Option,
  Schema,
} from "effect";
import { HttpClient } from "effect/http";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { ratkingExtension } from "../src/extension.ts";
import type { PiHost, SessionStart } from "../src/extension.ts";
import { shownIds } from "../src/pending.ts";
import { harness } from "./harness.ts";
import { startSession } from "./start-session.ts";

const idle = async () => {};

const ignoreShown = (_id: string) => {};

const ignoreDelivery: Deliver = () => Effect.void;

it.effect.prop(
  "Pi display alone acknowledges direct mail, asks, replies, next-turn copies and digests",
  [
    Arbitrary.schema(
      Schema.Literals([
        "direct",
        "ask",
        "reply",
        "nextTurn",
        "digest",
        "record",
      ])
    ),
  ],
  ([mode]) =>
    Effect.gen(function* displayProof() {
      let start: (facts: SessionStart) => Promise<void> = idle;
      let end: () => Promise<void> = idle;
      let shown: (id: string) => void = ignoreShown;
      let deliver: Deliver = ignoreDelivery;

      const sent: {
        readonly customType: string;
        readonly details?: unknown;
      }[] = [];

      const acked = yield* Deferred.make<boolean>();
      let acknowledgments = 0;
      const clock = yield* Clock.Clock;
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();

      const layer = Layer.mergeAll(
        harness(
          state,
          HttpClient.make(() => Effect.die("Unexpected request"))
        ),
        Layer.mock(RatKing, {
          run: (_facts, handler) =>
            Effect.sync(() => {
              deliver = handler;
            }),
        }),
        Layer.succeed(Clock.Clock, clock)
      );

      const pi: PiHost = {
        events: { emit: () => {}, on: () => () => {} },
        onMessageShown: (handler) => {
          shown = handler;
        },
        onSessionEnd: (handler) => {
          end = handler;
        },
        onSessionStart: (handler) => {
          start = handler;
        },
        registerMessageRenderer: () => {},
        registerTool: () => {},
        sendMessage: (message) => {
          sent.push(message);
        },
      };

      yield* Effect.promise(async () => {
        await ratkingExtension({
          facts: (session) =>
            Effect.succeed({
              alive: () => true,
              env: Option.none(),
              pane: Option.none(),
              pid: 1,
              session,
            }),
          layer,
          tool: Effect.succeed("ratking"),
        })(pi);
        await startSession(start, { session: "display", warn: () => {} });
      });

      const inbound: Inbound = {
        body: "mail",
        cc: false,
        copy: mode === "nextTurn" || mode === "digest",
        did: "did:web:sender.invalid",
        from: "sender",
        id: "mail-id",
        kind: mode === "ask" ? "ask" : "message",
        label: Option.none(),
        replyTo: mode === "reply" ? Option.some("ask-id") : Option.none(),
        summary: Option.none(),
        verified: true,
      };

      if (mode === "digest") {
        Object.assign(inbound, { digestMinutes: 1 });
      }

      yield* deliver(
        mode === "record"
          ? {
              did: inbound.did,
              from: inbound.from,
              id: inbound.id,
              record: { $type: "sh.example.desk.notice" },
              replyTo: Option.none(),
              verified: true,
            }
          : inbound,
        mode === "reply",
        Effect.sync(() => {
          acknowledgments += 1;
        }).pipe(Effect.andThen(Deferred.succeed(acked, true)), Effect.asVoid)
      );
      expect(acknowledgments).toBe(0);

      if (mode === "digest") {
        expect(sent).toHaveLength(0);
        yield* TestClock.adjust(120_000);
      }

      expect(sent).toHaveLength(1);

      for (const message of sent) {
        for (const id of shownIds({ ...message, role: "custom" })) {
          shown(id);
        }
      }

      yield* Deferred.await(acked);
      expect(acknowledgments).toBe(1);
      shown("mail-id");
      expect(acknowledgments).toBe(1);
      yield* Effect.promise(async () => {
        await end();
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
