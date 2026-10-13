// @effect-diagnostics asyncFunction:off
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Turn } from "@rat-king/lexicon/turns";
import type { TurnValue } from "@rat-king/lexicon/turns";
import {
  Arbitrary,
  Clock,
  ConfigProvider,
  Deferred,
  Effect,
  FileSystem,
  Layer,
  Option,
  Schema,
} from "effect";
import { HttpClient } from "effect/http";
import { asyncModelRun } from "fast-check";
import type { AsyncCommand } from "fast-check";
import { expect } from "vitest";

import { resolveTurnRecords } from "../src/config.ts";
import { ratkingExtension, RECORD_EVENT } from "../src/extension.ts";
import type { PiHost, SessionStart } from "../src/extension.ts";
import { RatKing, ReaderState } from "../src/ratking.ts";
import type { Deliver } from "../src/ratking.ts";
import { harness } from "./harness.ts";

const Case = Schema.Struct({
  fail: Schema.Boolean,
  initial: Schema.Int.check(Schema.isBetween({ maximum: 10, minimum: 0 })),
  owned: Schema.Boolean,
  reason: Schema.Literals(["stop", "aborted", "error", "length"]),
  turnRecords: Schema.optionalKey(Schema.Boolean),
});

const noop = async () => {};

const ignoreDelivery: Deliver = () => Effect.void;

interface TurnModel {
  readonly states: string[];
}

interface TurnDriver {
  readonly approval: () => Promise<void>;
  readonly done: () => Promise<void>;
  readonly records: readonly Submission[];
  readonly working: () => Promise<void>;
}

interface Submission {
  readonly owner: string;
  readonly record: TurnValue;
}

it.effect.prop(
  "session live, agent hooks and approval emit silent owner records once, with paired ids, or nothing without an owner",
  [Arbitrary.schema(Case)],
  ([sample]) =>
    Effect.gen(function* proof() {
      let start: (facts: SessionStart) => Promise<void> = noop;
      let end: () => Promise<void> = noop;
      let working: () => Promise<void> = noop;
      let done: (messages: readonly unknown[]) => Promise<void> = noop;
      let approval: () => Promise<void> = noop;

      const records: Submission[] = [];
      const emitting = sample.owned && sample.turnRecords === true;
      const remembered: number[] = [];
      const received: unknown[] = [];
      let deliver = ignoreDelivery;

      const idle = yield* Deferred.make<boolean>();
      const clock = yield* Clock.Clock;
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();

      const turnRecords = yield* resolveTurnRecords(sample).pipe(
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({})))
      );

      const layer = Layer.mergeAll(
        harness(
          state,
          HttpClient.make(() => Effect.die("Unexpected HTTP")),
          [],
          { turnRecords }
        ),
        Layer.mock(RatKing, {
          run: (facts, handler) =>
            Effect.sync(() => {
              deliver = handler;
              facts.onState?.(
                ReaderState.Live({
                  did: "did:web:worker.invalid",
                  expiresAt: "2030-01-01T00:00:00Z",
                  generation: 1,
                  name: "worker",
                })
              );
              facts.onState?.(
                ReaderState.Live({
                  did: "did:web:worker.invalid",
                  expiresAt: "2030-01-01T00:00:00Z",
                  generation: 1,
                  name: "worker",
                })
              );
            }),
          send: (owner, body) =>
            Effect.gen(function* send() {
              const record = yield* Schema.decodeUnknownEffect(Turn)(body).pipe(
                Effect.orDie
              );

              records.push({ owner, record });

              if (record.state === "idle") {
                yield* Deferred.succeed(idle, true);
              }

              if (sample.fail) {
                return yield* Effect.die("One failed send must not break Pi");
              }

              return {
                did: "did:web:owner.invalid",
                id: "id",
                seq: 1,
                to: owner,
              };
            }),
          status: Effect.succeed({
            endpoint: "https://mailbox.invalid",
            openAsks: 0,
            quarantine: { count: 0, latest: Option.none() },
            reader: ReaderState.Starting({ reason: "test" }),
            self: Option.some({
              did: "did:web:worker.invalid",
              name: "worker",
            }),
          }),
        }),
        Layer.succeed(Clock.Clock, clock)
      );

      const pi: PiHost = {
        events: {
          emit: (name, data) => {
            if (name === RECORD_EVENT) {
              received.push(data);
            }
          },
          on: () => () => {},
        },
        onAgentEnd: (handler) => {
          done = handler;
        },
        onAgentStart: (handler) => {
          working = handler;
        },
        onApproval: (handler) => {
          approval = handler;
        },
        onSessionEnd: (handler) => {
          end = handler;
        },
        onSessionStart: (handler) => {
          start = handler;
        },
        registerMessageRenderer: () => {},
        registerTool: () => {},
        sendMessage: () => {
          throw new Error("Turn record must not display or wake");
        },
      };

      yield* Effect.promise(async () => {
        await ratkingExtension({
          facts: (session) =>
            Effect.succeed({
              alive: () => true,
              env: Option.some("worker"),
              owner: sample.owned ? Option.some("owner") : Option.none(),
              pane: Option.none(),
              pid: 1,
              session,
            }),
          layer,
          tool: Effect.succeed("ratking"),
        })(pi);
      });
      yield* Effect.promise(async () => {
        await start({
          rememberTurn: (n) => {
            remembered.push(n);
          },
          session: "session",
          turnCount: sample.initial,
          warn: () => {},
        });
      });

      if (emitting) {
        yield* Deferred.await(idle);
      }

      for (const record of [
        {
          $type: "sh.mschf.agentgraph.turn",
          agent: "peer",
          at: "2030-01-01T00:00:00Z",
          session: "peer-session",
          state: "working",
          turnId: "peer-session:1",
          version: "0.1",
        },
        {
          $type: "sh.mschf.agentgraph.friction",
          at: "2030-01-01T00:00:00Z",
          graph: "sample",
          kind: "manual",
          project: "sample",
          slice: "f0",
          version: "0.1",
          what: "sample friction",
        },
      ]) {
        const acked = yield* Deferred.make<boolean>();

        yield* deliver(
          {
            did: "did:web:peer.invalid",
            from: "peer",
            id: record.$type,
            record,
            replyTo: Option.none(),
            verified: true,
          },
          false,
          Deferred.succeed(acked, true).pipe(Effect.asVoid)
        );
        yield* Deferred.await(acked);
      }

      expect(received).toHaveLength(2);

      const finish = async () => {
        await done([{ role: "assistant", stopReason: sample.reason }]);
      };

      const commands: AsyncCommand<TurnModel, TurnDriver>[] = Array.from(
        { length: 3 },
        () => ["working", "approval", "done"] as const
      )
        .flat()
        .map((event) => ({
          check: () => true,
          run: async (model, real) => {
            await real[event]();

            if (emitting) {
              model.states.push(event === "approval" ? "blocked" : event);
            }

            expect(real.records.map(({ record }) => record.state)).toEqual(
              model.states
            );
          },
          toString: () => event,
        }));

      const setup = () => ({
        model: { states: emitting ? ["idle"] : [] },
        real: { approval, done: finish, records, working },
      });

      yield* Effect.promise(async () => {
        await asyncModelRun(setup, commands);
      });

      yield* Effect.promise(end);

      expect(remembered).toEqual([1, 2, 3].map((n) => sample.initial + n));

      if (!emitting) {
        expect(records).toEqual([]);

        return;
      }

      expect(records.every((record) => record.owner === "owner")).toBe(true);
      expect(
        records.filter(({ record }) => record.state === "idle")
      ).toHaveLength(1);
      expect(records.map(({ record }) => record.state)).toEqual([
        "idle",
        ...Array.from({ length: 3 }, () => [
          "working",
          "blocked",
          "done",
        ]).flat(),
      ]);

      for (let n = 1; n <= 3; n += 1) {
        const pair = records.filter(
          ({ record }) => record.turnId === `session:${sample.initial + n}`
        );

        expect(
          pair.find(({ record }) => record.state === "done")?.record.stopReason
        ).toBe(sample.reason);
        expect(pair[0]?.record.state).toBe("working");
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 12 }, timeout: 30_000 }
);
