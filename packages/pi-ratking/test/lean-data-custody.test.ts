// @effect-diagnostics asyncFunction:off -- Pi's extension API is the Promise boundary under test.
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import type { Inbound } from "@rat-king/ratking-client/payload";
import { RatKing } from "@rat-king/ratking-client/ratking";
import type { Deliver } from "@rat-king/ratking-client/ratking";
import {
  Arbitrary,
  Clock,
  Effect,
  FileSystem,
  Layer,
  Option,
  Predicate,
  Schema,
} from "effect";
import { HttpClient } from "effect/http";
import { expect } from "vitest";

import { MESSAGE_EVENT, ratkingExtension } from "../src/extension.ts";
import type { PiHost, SessionStart } from "../src/extension.ts";
import { shownIds } from "../src/pending.ts";
import { harness } from "./harness.ts";
import { startSession } from "./start-session.ts";

const idle = async () => {};

const ignoreShown = (_id: string) => {};

const ignoreDelivery: Deliver = () => Effect.void;

const isClaim = (value: unknown): value is () => void =>
  Predicate.isFunction(value);

const Claim = Schema.Struct({ claim: Schema.declare(isClaim) });

it.effect.prop(
  "Data mail pi-ratking cannot render is acked only after a listener claims it or Pi shows it",
  [
    Arbitrary.schema(Schema.Boolean),
    Arbitrary.schema(Schema.Boolean),
    Arbitrary.schema(Schema.String),
  ],
  ([registered, claims, prompt]) =>
    Effect.gen(function* leanCustody() {
      let start: (facts: SessionStart) => Promise<void> = idle;
      let end: () => Promise<void> = idle;
      let shown: (id: string) => void = ignoreShown;
      let deliver: Deliver = ignoreDelivery;
      let claimed = false;
      let acknowledgments = 0;

      const sent: {
        readonly message: { readonly customType: string; details?: unknown };
        readonly triggerTurn: boolean | undefined;
      }[] = [];

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
        events: {
          emit: (channel, data) => {
            const offer = Schema.decodeUnknownOption(Claim)(data);

            if (channel === MESSAGE_EVENT && claims && Option.isSome(offer)) {
              claimed = true;
              offer.value.claim();
            }
          },
          on: () => () => {},
        },
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
        sendMessage: (message, delivery) => {
          sent.push({ message, triggerTurn: delivery?.triggerTurn });
        },
        toolRegistered: () => registered,
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
        await startSession(start, {
          isIdle: () => true,
          session: "lean",
          warn: () => {},
        });
      });

      const inbound: Inbound = {
        body: JSON.stringify({
          author: "desk-session",
          body: prompt,
          recipient: "lean",
          type: "message",
        }),
        cc: false,
        did: "did:web:desk.invalid",
        from: "desk",
        id: "prompt-mail",
        kind: "data",
        label: Option.none(),
        replyTo: Option.none(),
        summary: Option.none(),
        verified: true,
      };

      yield* deliver(
        inbound,
        false,
        Effect.sync(() => {
          acknowledgments += 1;
        })
      );
      yield* Effect.yieldNow;

      const handedOff = claimed || registered;

      expect(acknowledgments).toBe(handedOff ? 1 : 0);
      expect(sent.length).toBe(handedOff ? 0 : 1);

      for (const { message, triggerTurn } of sent) {
        expect(triggerTurn).toBe(true);

        for (const id of shownIds({ ...message, role: "custom" })) {
          shown(id);
        }
      }

      yield* Effect.yieldNow;
      expect(acknowledgments).toBe(1);
      yield* Effect.promise(async () => {
        await end();
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
