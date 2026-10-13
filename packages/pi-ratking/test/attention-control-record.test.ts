import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Deferred, Effect, FileSystem, Layer, Option, Schema } from "effect";
import { HttpClient } from "effect/http";
import { expect } from "vitest";

import {
  defaultPreferences,
  defaultStatus,
} from "../../mailbox-client/src/attention.ts";
import { ratkingExtension, RECORD_EVENT } from "../src/extension.ts";
import type { PiHost, SessionStart } from "../src/extension.ts";
import { RatKing } from "../src/ratking.ts";
import { harness } from "./harness.ts";

it.effect.prop(
  "Refuse, mute and DND do not change silent turn-record routing or display custody",
  [Schema.Boolean],
  ([enabled]) =>
    Effect.gen(function* controlRecord() {
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();
      const acked = yield* Deferred.make<boolean>();
      const received: unknown[] = [];
      let start = Option.none<(session: SessionStart) => Promise<void>>();
      let stop = Option.none<() => Promise<void>>();

      const record = {
        $type: "sh.mschf.agentgraph.turn",
        agent: "peer",
        at: "2030-01-01T00:00:00Z",
        session: "peer-session",
        state: "working",
        turnId: "peer-session:1",
        version: "0.1",
      };

      const inbound = {
        did: "did:web:peer.example.invalid",
        from: "peer",
        id: "turn-1",
        levers: {
          enabled,
          prefs: {
            ...defaultPreferences(),
            mute: [
              {
                $type: "sh.mschf.ratking.attention.prefs#thread",
                thread: "thread-1",
              },
            ],
            refuse: ["peer"],
          },
          status: { ...defaultStatus(), state: "dnd" },
        },
        record,
        replyTo: Option.none<string>(),
        verified: true,
      };

      const pi: PiHost = {
        events: {
          emit: (name, data) => {
            if (name === RECORD_EVENT) {
              received.push(data);
            }
          },
          on: () => () => {},
        },
        onSessionEnd: (handler) => {
          stop = Option.some(handler);
        },
        onSessionStart: (handler) => {
          start = Option.some(handler);
        },
        registerMessageRenderer: () => {},
        registerTool: () => {},
        sendMessage: () => {
          throw new Error("Control record must not display or wake");
        },
      };

      const initialize = ratkingExtension({
        facts: (session) =>
          Effect.succeed({
            alive: () => true,
            env: Option.some("worker"),
            pane: Option.none(),
            pid: 1,
            session,
          }),
        layer: Layer.merge(
          harness(
            state,
            HttpClient.make(() => Effect.die("Unexpected HTTP")),
            [],
            { attentionLevers: enabled }
          ),
          Layer.mock(RatKing, {
            run: (_facts, deliver) =>
              deliver(
                inbound,
                false,
                Deferred.succeed(acked, true).pipe(Effect.asVoid)
              ),
          })
        ),
        tool: Effect.succeed("ratking"),
      });

      yield* Effect.promise(initialize.bind(undefined, pi));
      const startSession = yield* Effect.fromOption(start);
      yield* Effect.promise(
        startSession.bind(undefined, { session: "session", warn: () => {} })
      );
      yield* Deferred.await(acked);
      expect(received).toEqual([
        {
          did: inbound.did,
          from: "peer",
          id: "turn-1",
          record,
          verified: true,
        },
      ]);
      const stopSession = yield* Effect.fromOption(stop);
      yield* Effect.promise(stopSession);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
