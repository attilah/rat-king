// @effect-diagnostics asyncFunction:off -- Pi session hooks are the Promise boundary.
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import * as Prefs from "@rat-king/lexicon/attention.prefs";
import { RatKing } from "@rat-king/ratking-client/ratking";
import type { Deliver } from "@rat-king/ratking-client/ratking";
import { Deferred, Effect, FileSystem, Layer, Option, Schema } from "effect";
import { HttpClient } from "effect/http";
import { expect } from "vitest";

import { defaultPreferences } from "../../mailbox-client/src/attention.ts";
import { ratkingExtension, RECORD_EVENT } from "../src/extension.ts";
import type { PiHost, SessionStart } from "../src/extension.ts";
import { harness } from "./harness.ts";
import { startSession } from "./start-session.ts";

const Scenario = Schema.Struct({
  expired: Schema.Boolean,
  kind: Schema.Literals(["message", "turn", "notice"]),
  operator: Schema.Boolean,
  route: Schema.Literals(["wake", "quiet", "digest", "hide"]),
});

const nothing = () => {};

const idle = async () => {};

const noDelivery: Deliver = () => Effect.void;

type Message = Parameters<PiHost["sendMessage"]>[0];

type Delivery = Parameters<PiHost["sendMessage"]>[1];

const ruleOf = (scenario: typeof Scenario.Type, type: string) =>
  Schema.decodeUnknownSync(Prefs.Rule)({
    id: "rule",
    match: scenario.operator
      ? {}
      : {
          from: "agent-graph/*",
          type: scenario.kind === "message" ? "message" : type,
        },
    ...(scenario.route === "digest" ? { minutes: 10 } : { note: "no digest" }),
    route: scenario.route,
    until: scenario.expired ? "1970-01-01T00:00:00Z" : "2099-01-01T00:00:00Z",
  });

it.effect.prop(
  "fake inbox keeps custody through the filter decision and display; hidden turns ack silently after their hook, expiry and Joel bypass restore the old route",
  [Scenario],
  ([scenario]) =>
    Effect.gen(function* deliveryProof() {
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();
      const acked = yield* Deferred.make<boolean>();
      const events: string[] = [];
      const messages: { delivery: Delivery; message: Message }[] = [];
      let start: (session: SessionStart) => Promise<void> = idle;
      let stop: () => Promise<void> = idle;
      let before = nothing;
      let shown: (id: string) => void = nothing;
      let deliver: Deliver = noDelivery;
      const record = scenario.kind !== "message";
      const from = scenario.operator ? "joel" : "agent-graph/worker";

      const type =
        scenario.kind === "turn"
          ? "sh.mschf.agentgraph.turn"
          : "example.notice";

      const rule = ruleOf(scenario, type);

      const levers = {
        enabled: true,
        prefs: { ...defaultPreferences(), rules: [rule] },
      };

      const base = {
        did: "did:web:worker.example.invalid",
        from,
        id: "arrival",
        levers,
        replyTo: Option.none<string>(),
        verified: true,
      };

      const inbound = record
        ? {
            ...base,
            record: {
              $type: type,
              agent: from,
              at: "2030-01-01T00:00:00Z",
              session: "source",
              state: "done",
              turnId: "source:1",
              version: "0.1",
            },
          }
        : {
            ...base,
            body: "mail",
            cc: false,
            kind: "message" as const,
            label: Option.none<string>(),
            summary: Option.none<string>(),
          };

      const pi: PiHost = {
        events: {
          emit: (event) => {
            if (event === RECORD_EVENT) {
              events.push("record");
            }
          },
          on: () => nothing,
        },
        noteSettledRecord: () => {
          events.push("settled");
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
        sendMessage: (message, delivery) => {
          messages.push({ delivery, message });
        },
      };

      const init = ratkingExtension({
        facts: (session) =>
          Effect.succeed({
            alive: () => true,
            env: Option.some("agent-graph/desk"),
            pane: Option.none(),
            pid: 1,
            reads: true,
            session,
          }),
        layer: Layer.merge(
          harness(
            state,
            HttpClient.make(() => Effect.die("Unexpected HTTP"))
          ),
          Layer.mock(RatKing, {
            run: (_facts, handler) =>
              Effect.sync(() => {
                deliver = handler;
              }),
          })
        ),
        tool: Effect.succeed("ratking"),
      });

      yield* Effect.promise(init.bind(undefined, pi));
      yield* Effect.promise(async () => {
        await startSession(start, {
          isIdle: () => true,
          session: "receiver",
          warn: nothing,
        });
      });
      yield* Effect.addFinalizer(() => Effect.promise(stop));
      expect(yield* Deferred.poll(acked)).toEqual(Option.none());
      expect(messages).toEqual([]);
      yield* deliver(
        inbound,
        false,
        Deferred.succeed(acked, true).pipe(Effect.asVoid)
      );
      const filtered = !scenario.expired && !scenario.operator;
      const hidden = filtered && scenario.route === "hide";

      const quiet =
        filtered && (scenario.route === "quiet" || scenario.route === "digest");

      const silentlyScoped = scenario.operator && scenario.kind === "turn";

      if (record) {
        expect(events[0]).toBe("record");
      }

      if (hidden || silentlyScoped) {
        yield* Deferred.await(acked);
        expect(messages).toEqual([]);
      } else {
        expect(yield* Deferred.poll(acked)).toEqual(Option.none());

        if (quiet) {
          expect(messages).toEqual([]);
          before();

          if (record || scenario.route === "quiet") {
            expect(messages).toHaveLength(1);
            expect(messages[0]?.delivery).toMatchObject({
              deliverAs: "nextTurn",
              triggerTurn: false,
            });
          }
        } else {
          expect(messages).toHaveLength(1);
          expect(messages[0]?.delivery?.triggerTurn).toBe(
            scenario.kind !== "notice"
          );
        }

        if (messages.length > 0) {
          shown(inbound.id);
          yield* Deferred.await(acked);
        }
      }

      expect(events.filter((event) => event === "record")).toHaveLength(
        record ? 1 : 0
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 100 } }
);
