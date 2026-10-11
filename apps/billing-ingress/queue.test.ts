// @effect-diagnostics asyncFunction:off nodeBuiltinImport:off -- Node SQLite and fast-check are offline test adapters.
/* oxlint-disable typescript/promise-function-async -- fast-check asyncModelRun consumes Promise commands. */
import { DatabaseSync } from "node:sqlite";

import { it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import { TestClock } from "effect/testing";
import { asyncModelRun } from "fast-check";
import type { AsyncCommand } from "fast-check";
import { expect } from "vitest";

import { BATCH_LIMIT, RETENTION } from "./contracts.ts";
import { alertKey } from "./http.ts";
import { initialize, queueMethods } from "./queue.ts";

const Step = Schema.Struct({
  kind: Schema.Literals(["insert", "replay", "ack", "expire", "pull"]),
  slot: Schema.Int.check(Schema.isBetween({ maximum: 5, minimum: 0 })),
});

const Steps = Schema.Array(Step).check(
  Schema.isMinLength(10),
  Schema.isMaxLength(60)
);

it.effect.prop(
  "models replay, ack tombstones and 7-day expiration against real SQL",
  { steps: Arbitrary.schema(Steps) },
  ({ steps }) =>
    Effect.gen(function* modelTest() {
      const database = new DatabaseSync(":memory:");
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          database.close();
        })
      );

      const sql = {
        exec: (query: string, ...values: readonly (string | number | null)[]) =>
          database.prepare(query).all(...values),
        transaction: <A>(operation: () => A) => {
          database.exec("BEGIN");

          try {
            const result = operation();
            database.exec("COMMIT");

            return result;
          } catch (error) {
            database.exec("ROLLBACK");
            throw error;
          }
        },
      };

      initialize(sql);
      const queue = queueMethods(sql);

      const keys = yield* Effect.forEach([0, 1, 2, 3, 4, 5], (slot) =>
        alertKey({ notification_id: slot }, "unused")
      );

      const outer = yield* Effect.context();

      interface Model {
        now: number;
        rows: Map<string, { receivedAt: number; acked: boolean }>;
      }

      const commands: AsyncCommand<Model, typeof queue>[] = steps.map(
        (step) => ({
          check: () => true,
          run: async (model, real) => {
            // oxlint-disable-next-line effect-tests/no-manual-effect-runtime-in-tests -- asyncModelRun requires a Promise command.
            await Effect.runPromiseWith(outer)(
              Effect.gen(function* command() {
                const id = keys[step.slot];

                if (id === undefined) {
                  throw new Error("Generated slot out of range");
                }

                if (step.kind === "expire") {
                  model.now += RETENTION;
                }

                yield* TestClock.setTime(model.now);

                for (const [key, row] of model.rows) {
                  if (row.receivedAt <= model.now - RETENTION) {
                    model.rows.delete(key);
                  }
                }

                if (step.kind === "insert" || step.kind === "replay") {
                  const payload = {
                    name: "invented alert",
                    notification_id: step.slot,
                  };

                  expect(yield* alertKey(payload, "changed bytes")).toBe(id);
                  yield* real.insert({ id, payload, receivedAt: model.now });

                  if (!model.rows.has(id)) {
                    model.rows.set(id, { acked: false, receivedAt: model.now });
                  }
                } else if (step.kind === "ack") {
                  yield* real.ack([id]);
                  const row = model.rows.get(id);

                  if (row !== undefined) {
                    row.acked = true;
                  }
                }

                const pending = yield* real.pull();
                expect(pending.map((alert) => alert.id).toSorted()).toEqual(
                  [...model.rows]
                    .flatMap(([key, row]) => (row.acked ? [] : [key]))
                    .toSorted()
                    .slice(0, BATCH_LIMIT)
                );
                expect([...sql.exec("SELECT id FROM alerts")]).toHaveLength(
                  model.rows.size
                );
              })
            );
          },
          toString: () => `${step.kind}:${step.slot}`,
        })
      );

      yield* Effect.promise(() =>
        asyncModelRun(
          () => ({ model: { now: 0, rows: new Map() }, real: queue }),
          commands
        )
      );
    })
);

it.effect.prop(
  "fallback body hash distinguishes content and dedupes identical bytes",
  { text: Arbitrary.schema(Schema.String) },
  ({ text }) =>
    Effect.gen(function* fallback() {
      const id = yield* alertKey(null, text);
      expect(yield* alertKey(null, text)).toBe(id);
      expect(yield* alertKey(null, `${text}x`)).not.toBe(id);
    })
);
