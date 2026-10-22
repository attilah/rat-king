// @effect-diagnostics asyncFunction:off -- Pi callbacks are the Promise boundary.
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import type { LexiconRecordValue } from "@rat-king/ratking-client/payload";
import { RatKing } from "@rat-king/ratking-client/ratking";
import type { Deliver } from "@rat-king/ratking-client/ratking";
import {
  Arbitrary,
  Deferred,
  Effect,
  FileSystem,
  Layer,
  Option,
  Schema,
} from "effect";
import { HttpClient } from "effect/http";
import { expect } from "vitest";

import { ratkingExtension } from "../src/extension.ts";
import type { PiHost, SessionStart } from "../src/extension.ts";
import { harness } from "./harness.ts";
import { startSession } from "./start-session.ts";

const idle = async () => {};

const nothing = () => {};

const ignoreShown = (_id: string) => {};

const ignoreDelivery: Deliver = () => Effect.void;

const Cases = Schema.Literals([
  "typed-working",
  "typed-crashed",
  "body-working",
  "body-crashed",
  "body-wake",
]);

const record = (kind: typeof Cases.Type): LexiconRecordValue =>
  kind === "body-wake"
    ? {
        $type: "sh.mschf.agentgraph.wake",
        finishedAt: "2030-01-01T00:00:01Z",
        kind: "ping",
        label: "Gate ready",
        source: "herdr_ping_wait",
        startedAt: "2030-01-01T00:00:00Z",
        status: "matched",
        text: "The gate is clear.",
        watch: "sample-watch",
      }
    : {
        $type: "sh.mschf.agentgraph.turn",
        agent: "fleet/peer",
        at: "2030-01-01T00:00:00Z",
        session: "peer-session",
        state: kind.endsWith("crashed") ? "crashed" : "working",
        turnId: "peer-session:1",
        version: "0.1",
      };

it.effect.prop(
  "typed crashes acknowledge at display; silent turns and legacy-body wake controls settle once",
  [Arbitrary.schema(Cases)],
  ([kind]) =>
    Effect.gen(function* controlCustody() {
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();
      const acked = yield* Deferred.make<boolean>();
      let acknowledgments = 0;
      let displayed = 0;
      let start: (facts: SessionStart) => Promise<void> = idle;
      let end: () => Promise<void> = idle;
      let shown = ignoreShown;
      let deliver = ignoreDelivery;
      const notes: { readonly id: string; readonly type: string }[] = [];

      const pi: PiHost = {
        events: { emit: nothing, on: () => nothing },
        noteSettledRecord: (id, type) => {
          notes.push({ id, type });
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
        registerMessageRenderer: nothing,
        registerTool: nothing,
        sendMessage: () => {
          displayed += 1;
        },
      };

      yield* Effect.promise(async () => {
        await ratkingExtension({
          facts: (session) =>
            Effect.succeed({
              alive: () => true,
              env: Option.some("fleet/owner"),
              pane: Option.none(),
              pid: 1,
              session,
            }),
          layer: Layer.merge(
            harness(
              state,
              HttpClient.make(() => Effect.die("Unexpected request"))
            ),
            Layer.mock(RatKing, {
              run: (_facts, handler) =>
                Effect.sync(() => {
                  deliver = handler;
                }),
            })
          ),
          tool: Effect.succeed("ratking"),
        })(pi);
        await startSession(start, {
          session: "control-custody",
          warn: nothing,
        });
      });
      yield* Effect.addFinalizer(() => Effect.promise(end));
      const value = record(kind);

      const facts = {
        did: "did:web:peer.example.invalid",
        from: "fleet/peer",
        id: "3control1234",
        replyTo: Option.none<string>(),
        verified: true,
      };

      const inbound = kind.startsWith("typed")
        ? { ...facts, record: value }
        : {
            ...facts,
            body: JSON.stringify(value),
            cc: false,
            kind: "data" as const,
            label: Option.none<string>(),
            summary: Option.none<string>(),
          };

      yield* deliver(
        inbound,
        false,
        Effect.sync(() => {
          acknowledgments += 1;
        }).pipe(Effect.andThen(Deferred.succeed(acked, true)), Effect.asVoid)
      );
      expect(displayed).toBe(kind === "typed-crashed" ? 1 : 0);

      if (kind === "typed-crashed") {
        shown(facts.id);
      }

      yield* Deferred.await(acked);
      shown(facts.id);
      shown(facts.id);
      expect(displayed).toBe(kind === "typed-crashed" ? 1 : 0);
      expect(acknowledgments).toBe(1);
      expect(notes).toEqual([{ id: facts.id, type: value.$type }]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { maxShrinks: 15, runs: 25 } }
);
