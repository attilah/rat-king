// @effect-diagnostics asyncFunction:off -- Pi test callbacks are Promise boundaries.
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { RatKing } from "@rat-king/ratking-client/ratking";
import type { Deliver } from "@rat-king/ratking-client/ratking";
import { Effect, FileSystem, Layer, Option, Predicate, Schema } from "effect";
import { HttpClient } from "effect/http";
import { expect } from "vitest";

import { ratkingExtension } from "../src/extension.ts";
import type { PiHost, SessionStart } from "../src/extension.ts";
import { shownIds } from "../src/pending.ts";
import { harness } from "./harness.ts";
import { startSession } from "./start-session.ts";

const nothing = () => {};

const ignoreShown = (_id: string) => {};

const ignoreDelivery: Deliver = () => Effect.void;

const idleHandler = async () => {
  await Promise.resolve();
};

it.effect.prop(
  "the reader offers held wake batches with their own custom type and reason, and acks only display",
  [Schema.Int.check(Schema.isBetween({ maximum: 4, minimum: 1 }))],
  ([count]) =>
    Effect.gen(function* wakeHeaderReader() {
      let start: (session: SessionStart) => Promise<void> = idleHandler;
      let stop: () => Promise<void> = idleHandler;
      let idle: (messages: readonly unknown[]) => Promise<void> = idleHandler;
      let before = nothing;
      let shown = ignoreShown;
      let deliver = ignoreDelivery;
      const requests: unknown[] = [];
      const acked: string[] = [];
      const fs = yield* FileSystem.FileSystem;

      const layer = Layer.merge(
        harness(
          yield* fs.makeTempDirectoryScoped(),
          HttpClient.make(() => Effect.die("Unexpected HTTP"))
        ),
        Layer.mock(RatKing, {
          run: (_facts, handler) =>
            Effect.sync(() => {
              deliver = handler;
            }),
        })
      );

      const pi: PiHost = {
        events: {
          emit: (event, request) => {
            if (event === "pi-until:follow-up") {
              const value = Schema.decodeUnknownSync(
                Schema.Struct({
                  accept: Schema.declare((input): input is () => void =>
                    Predicate.isFunction(input)
                  ),
                  content: Schema.String,
                  customType: Schema.String,
                  details: Schema.Unknown,
                })
              )(request);

              requests.push(value);
              value.accept();
            }
          },
          on: () => nothing,
        },
        onAgentEnd: (handler) => {
          idle = handler;
        },
        onBeforeAgentStart: (handler) => {
          before = handler;
        },
        onMessageShown: (handler) => {
          shown = handler;
        },
        onSessionEnd: (handler) => {
          stop = handler;
        },
        onSessionStart: (handler) => {
          start = handler;
        },
        registerMessageRenderer: nothing,
        registerTool: nothing,
        sendMessage: () => {
          throw new Error("Accepted arbiter request must not send directly");
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
      });
      yield* Effect.promise(async () => {
        await startSession(start, { session: "wake-header", warn: nothing });
      });
      yield* Effect.addFinalizer(() => Effect.promise(stop));
      before();

      for (let index = 0; index < count; index += 1) {
        const id = String(index);

        yield* deliver(
          {
            did: "did:key:invented",
            from: "worker",
            id,
            record: {
              $type: "sh.mschf.agentgraph.wake",
              finishedAt: "2026-01-01T00:01:00Z",
              kind: "ping",
              label: `Watch ${index}`,
              source: "herdr_ping_wait",
              startedAt: "2026-01-01T00:00:00Z",
              status: "matched",
              text: `Wake ${index}`,
              watch: id,
            },
            replyTo: Option.none(),
            verified: true,
          },
          false,
          Effect.sync(() => {
            acked.push(id);
          })
        );
      }

      expect(requests).toEqual([]);
      yield* Effect.promise(async () => {
        await idle([]);
      });
      expect(requests).toHaveLength(1);
      expect(acked).toEqual([]);
      const [request] = requests;

      const value = yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          content: Schema.String,
          customType: Schema.String,
          details: Schema.Unknown,
        })
      )(request);

      expect(value.customType).toBe("ratking_wake");
      expect(value.content).toContain(`**🐀 wake** · ${count}`);
      expect(value.details).toMatchObject({ reason: { facts: ["wake"] } });

      for (const id of shownIds({
        customType: value.customType,
        details: { followUpId: "follow-up", receipt: value.details },
        role: "custom",
      })) {
        shown(id);
      }

      yield* Effect.yieldNow;
      expect(acked).toEqual(
        Array.from({ length: count }, (_, index) => String(index))
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
