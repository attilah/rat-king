/* oxlint-disable typescript/promise-function-async, effect-tests/no-manual-effect-runtime-in-tests -- asyncModelRun bridges commands through the owning test context. */
import { it } from "@effect/vitest";
import { Arbitrary, Effect, Option, Result, Schema } from "effect";
import * as fc from "fast-check";
import type { AsyncCommand } from "fast-check";
import { expect } from "vitest";

import { AskJournal, openAsks } from "../src/asks.ts";
import type { PendingAskValue } from "../src/asks.ts";
import type { Inbound } from "../src/payload.ts";

class SaveFailed extends Schema.TaggedError<SaveFailed>()("SaveFailed", {}) {}

const Operation = Schema.Struct({
  action: Schema.Literals([
    "record",
    "ack",
    "reply",
    "nudge",
    "clock",
    "reopen",
  ]),
  deadline: Schema.Boolean,
  failAt: Schema.Int.check(Schema.isBetween({ maximum: 2, minimum: -1 })),
  id: Schema.Literals(["a", "b", "c"]),
  peer: Schema.Literals(["did:web:one.invalid", "did:web:two.invalid"]),
});

interface Model {
  entries: PendingAskValue[];
  now: number;
}

const ConcurrentIds = Schema.Literals(["a", "b", "c"]);

const ordered = (entries: readonly PendingAskValue[]) =>
  entries.toSorted((a, b) => a.id.localeCompare(b.id));

it.effect.prop(
  "multi-ask writes commit only after save, including partial nudge failure and reopen",
  [
    Arbitrary.schema(Schema.Array(Operation).check(Schema.isMaxLength(50))),
    Schema.Literals([0, 1, 2]),
  ],
  ([operations, failedSave]) =>
    Effect.gen(function* persistenceModel() {
      const context = yield* Effect.context();
      let saved = "[]";
      let now = 0;
      let failAt = -1;
      let writes = 0;

      const open = openAsks({
        load: Effect.suspend(() =>
          Schema.decodeUnknownEffect(Schema.fromJsonString(AskJournal))(saved)
        ).pipe(Effect.orDie),
        now: Effect.sync(() => now),
        save: (entries) =>
          Effect.suspend(() => {
            const index = writes;
            writes += 1;

            if (index === failAt) {
              return Effect.fail(new SaveFailed());
            }

            return Schema.encodeEffect(Schema.fromJsonString(AskJournal))(
              entries
            ).pipe(
              Effect.orDie,
              Effect.tap((json) =>
                Effect.sync(() => {
                  saved = json;
                })
              ),
              Effect.asVoid
            );
          }),
      });

      const real = { journal: yield* open };

      const operation = (
        action: (typeof Operation.Type)["action"],
        saveFailure = -1
      ): typeof Operation.Type => ({
        action,
        deadline: true,
        failAt: saveFailure,
        id: "a",
        peer: "did:web:one.invalid",
      });

      const sequence: (typeof Operation.Type)[] = [
        ...operations,
        ...ConcurrentIds.literals.map((id): typeof Operation.Type => ({
          ...operation("record"),
          id,
        })),
        operation("clock"),
        operation("nudge", failedSave),
        operation("reopen"),
        operation("nudge"),
        operation("nudge"),
        operation("reopen"),
      ];

      const commands: AsyncCommand<Model, typeof real>[] = sequence.map(
        (op) => ({
          check: () => true,
          run: (model, actual) =>
            Effect.runPromiseWith(context)(
              Effect.gen(function* step() {
                ({ failAt } = op);
                writes = 0;
                let expectedWrites = 0;
                let failed = false;

                const commit = (ask: PendingAskValue) => {
                  const index = expectedWrites;
                  expectedWrites += 1;

                  if (index === op.failAt) {
                    failed = true;

                    return false;
                  }

                  model.entries = [
                    ...model.entries.filter((entry) => entry.id !== ask.id),
                    ask,
                  ];

                  return true;
                };

                if (op.action === "clock") {
                  model.now += 1;
                  ({ now } = model);
                }

                if (op.action === "reopen") {
                  actual.journal = yield* open;
                }

                if (op.action === "record") {
                  const ask: PendingAskValue = {
                    did: op.peer,
                    id: op.id,
                    sentAt: now,
                    state: "pending",
                    summary: op.id,
                    to: "peer",
                  };

                  if (op.deadline) {
                    Object.assign(ask, { dueBy: now + 1 });
                  }

                  commit(ask);

                  const result = yield* actual.journal
                    .record(ask)
                    .pipe(Effect.result);

                  expect(Result.isFailure(result)).toBe(failed);
                }

                if (op.action === "ack" || op.action === "reply") {
                  const entry = model.entries.find(
                    (ask) =>
                      ask.id === op.id &&
                      ask.state !== "closed" &&
                      (op.action === "ack" || ask.did === op.peer)
                  );

                  if (entry !== undefined) {
                    commit({
                      ...entry,
                      state: op.action === "ack" ? "closed" : "answered",
                    });
                  }

                  const inbound: Inbound = {
                    body: "reply",
                    cc: false,
                    did: op.peer,
                    from: "peer",
                    id: "reply",
                    kind: "reply",
                    label: Option.none(),
                    replyTo: Option.some(op.id),
                    summary: Option.none(),
                    verified: true,
                  };

                  const result = yield* (
                    op.action === "ack"
                      ? actual.journal
                          .ack(op.id)
                          .pipe(Effect.as(Option.none<PendingAskValue>()))
                      : actual.journal.match(inbound)
                  ).pipe(Effect.result);

                  expect(Result.isFailure(result)).toBe(failed);

                  if (op.action === "reply" && Result.isSuccess(result)) {
                    expect(result.success).toEqual(Option.fromNullishOr(entry));
                  }
                }

                if (op.action === "nudge") {
                  const due = model.entries.filter(
                    (ask) =>
                      ask.state === "pending" &&
                      ask.dueBy !== undefined &&
                      ask.dueBy <= now
                  );

                  for (const ask of due) {
                    if (!commit({ ...ask, state: "nudged" })) {
                      break;
                    }
                  }

                  const result = yield* actual.journal.nudges.pipe(
                    Effect.result
                  );

                  expect(Result.isFailure(result)).toBe(failed);

                  if (Result.isSuccess(result)) {
                    expect(result.success).toEqual(due);
                  }
                }

                expect(writes).toBe(expectedWrites);
                expect(ordered(yield* actual.journal.pending)).toEqual(
                  ordered(model.entries.filter((ask) => ask.state !== "closed"))
                );
                expect(
                  ordered(
                    yield* Schema.decodeUnknownEffect(
                      Schema.fromJsonString(AskJournal)
                    )(saved)
                  )
                ).toEqual(ordered(model.entries));
              })
            ),
          toString: () => JSON.stringify(op),
        })
      );

      yield* Effect.promise(() =>
        fc.asyncModelRun(
          () => ({ model: { entries: [], now: 0 }, real }),
          commands
        )
      );
    }),
  { arbitrary: { runs: 150, seed: 31_337 } }
);

it.effect(
  "concurrent records preserve every ask across a delayed save and reopen",
  () =>
    Effect.gen(function* concurrentRecords() {
      const context = yield* Effect.context();

      yield* Effect.promise(() =>
        fc.assert(
          fc.asyncProperty(
            fc.shuffledSubarray([...ConcurrentIds.literals], { minLength: 2 }),
            (ids) =>
              Effect.runPromiseWith(context)(
                Effect.gen(function* concurrentBatch() {
                  let durable: readonly PendingAskValue[] = [];

                  const open = openAsks({
                    load: Effect.sync(() => durable),
                    now: Effect.succeed(0),
                    save: (entries) =>
                      Effect.yieldNow.pipe(
                        Effect.andThen(
                          Effect.sync(() => {
                            durable = entries;
                          })
                        )
                      ),
                  });

                  const journal = yield* open;

                  const asks = ids.map((id): PendingAskValue => ({
                    did: "did:web:peer.invalid",
                    id,
                    sentAt: 0,
                    state: "pending",
                    summary: id,
                    to: "peer",
                  }));

                  yield* Effect.forEach(asks, (ask) => journal.record(ask), {
                    concurrency: "unbounded",
                  });
                  const reopened = yield* open;
                  expect(ordered(yield* journal.pending)).toEqual(
                    ordered(asks)
                  );
                  expect(ordered(yield* reopened.pending)).toEqual(
                    ordered(asks)
                  );
                })
              )
          ),
          { numRuns: 20, seed: 31_337 }
        )
      );
    })
);
