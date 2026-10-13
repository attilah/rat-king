import { it } from "@effect/vitest";
import { Turn } from "@rat-king/lexicon/turns";
import type { TurnValue } from "@rat-king/lexicon/turns";
import { Arbitrary, Clock, Effect, Layer, Option, Schema } from "effect";
import { expect } from "vitest";

import { openAsks } from "../src/asks.ts";
import { Settings } from "../src/config.ts";
import { withTurnWait } from "../src/extension.ts";
import { AskFailed, RatKing, ReaderState } from "../src/ratking.ts";
import { turnReporter } from "../src/turn-record.ts";

const Case = Schema.Struct({
  count: Schema.Int.check(Schema.isBetween({ maximum: 3, minimum: 1 })),
  fail: Schema.Boolean,
  reason: Schema.Literals(["stop", "aborted", "error", "length"]),
});

interface AskRequest {
  readonly action: "ask";
  readonly wait?: boolean;
}

it.effect.prop(
  "open async asks never block a turn; only explicit wait blocks and resumes, without a new turn id",
  [Arbitrary.schema(Case)],
  ([sample]) =>
    Effect.gen(function* proof() {
      for (const enabled of [false, true]) {
        for (const wait of [undefined, false, true]) {
          const journal = yield* openAsks({
            load: Effect.succeed([]),
            now: Clock.currentTimeMillis,
            save: () => Effect.void,
          });

          const records: TurnValue[] = [];
          const params: AskRequest = { action: "ask" };

          if (wait !== undefined) {
            Object.assign(params, { wait });
          }

          const waiting = enabled && wait === true;
          const currentState = waiting ? "blocked" : "working";

          const reporter = turnReporter({
            alive: () => true,
            env: Option.none(),
            owner: Option.some("owner"),
            pane: Option.none(),
            pid: 1,
            session: "sample-session",
          });

          const layer = Layer.mergeAll(
            Layer.succeed(
              Settings,
              Settings.of({
                askTimeoutMs: 600_000,
                didTemplate: "did:web:{agent}.invalid",
                directory: "unused",
                documents: [],
                encrypt: false,
                endpoint: "https://mailbox.invalid",
                issuer: Option.none(),
                refuse: [],
                relays: [],
                reserved: {},
                secretsCommand: "unused",
                serviceDid: "did:web:service.invalid",
                state: "unused",
                turnRecords: enabled,
              })
            ),
            Layer.mock(RatKing, {
              send: (to, body) =>
                Schema.decodeUnknownEffect(Turn)(body).pipe(
                  Effect.orDie,
                  Effect.tap((record) =>
                    Effect.sync(() => {
                      records.push(record);
                    })
                  ),
                  Effect.as({
                    did: "did:web:owner.invalid",
                    id: "receipt",
                    seq: 1,
                    to,
                  })
                ),
              status: Effect.gen(function* status() {
                return {
                  endpoint: "https://mailbox.invalid",
                  openAsks: (yield* journal.pending).length,
                  quarantine: { count: 0, latest: Option.none() },
                  reader: ReaderState.Starting({ reason: "sample" }),
                  self: Option.some({
                    did: "did:web:worker.invalid",
                    name: "worker",
                  }),
                };
              }),
            })
          );

          yield* Effect.gen(function* project() {
            const expected = enabled ? ["working"] : [];
            yield* reporter.working();
            expect((yield* journal.pending).length).toBe(0);
            expect(records.map((record) => record.state)).toEqual(expected);

            const failure = new AskFailed({
              code: "NoReply",
              reason: "Sample wait failure",
            });

            const action = Effect.gen(function* ask() {
              for (let n = 0; n < sample.count; n += 1) {
                yield* journal.record({
                  did: "did:web:peer.invalid",
                  id: `ask-${n}`,
                  sentAt: yield* Clock.currentTimeMillis,
                  state: "pending",
                  summary: "Sample question",
                  to: "peer",
                });
              }

              expect(records.at(-1)?.state).toBe(
                enabled ? currentState : undefined
              );

              if (sample.fail) {
                return yield* Effect.fail(failure);
              }

              return "answer";
            });

            const result = withTurnWait(reporter, params, action);

            if (sample.fail) {
              expect(yield* Effect.flip(result)).toBe(failure);
            } else {
              expect(yield* result).toBe("answer");
            }

            if (waiting) {
              expected.push("blocked", "working");
            }

            expect(records.map((record) => record.state)).toEqual(expected);
            yield* reporter.done(sample.reason);

            if (enabled) {
              expected.push("done");
            }

            expect(records.map((record) => record.state)).toEqual(expected);
            expect(
              records.every((record) => record.turnId === "sample-session:1")
            ).toBe(true);
            expect((yield* journal.pending).length).toBe(sample.count);
          }).pipe(Effect.provide(layer));
        }
      }
    })
);
