import { Effect, Function as Fn, Schema } from "effect";
import { asyncModelRun } from "fast-check";
import type { AsyncCommand } from "fast-check";
import { expect } from "vitest";

import { SqlCells } from "../adapters/sqlite.ts";
import type { Sql } from "../adapters/sqlite.ts";
import { MemoryRecord, Store } from "../src/contract.ts";
import type { DeliveryValue, MemoryRecordValue } from "../src/contract.ts";

interface Model {
  address: number;
  epoch: number;
  invalid: boolean;
  run: number;
  used: boolean;
  visit: number;
  written: Set<string>;
}

interface Real {
  record: MemoryRecordValue;
  sql: Sql;
  store: typeof Store.Service;
}

export type StoreAction =
  | "write"
  | "replay"
  | "advance"
  | "use"
  | "invalidate"
  | "run"
  | "key"
  | "visit";

const initial = (): Model => ({
  address: 0,
  epoch: 0,
  invalid: false,
  run: 0,
  used: false,
  visit: 0,
  written: new Set(),
});

const identity = (model: Model): DeliveryValue => ({
  epoch: model.epoch,
  key: `store-${model.address}`,
  runId: `model-${model.run}`,
  visit: model.visit,
});

const perform = Effect.fn("Remembers.test.modelCommand")(function* perform(
  action: StoreAction,
  model: Model,
  real: Real
) {
  if (action === "use") {
    yield* real.store.use("orchid", real.record.id, "acted", 5000);
    model.used = true;
  } else if (action === "invalidate") {
    yield* real.store.commit(
      { epoch: 0, key: "invalidate", runId: "model", visit: 0 },
      [
        {
          ...real.record,
          invalid_at: 6000,
          reobserved: [
            { at: 0, conversation: JSON.stringify(identity(initial())) },
          ],
        },
      ]
    );
    model.invalid = true;
  } else {
    if (action === "advance") {
      model.epoch += 1;
    }

    if (action === "run") {
      model.run += 1;
    }

    if (action === "key") {
      model.address += 1;
    }

    if (action === "visit") {
      model.visit += 1;
    }

    const delivery = identity(action === "replay" ? initial() : model);
    const event = JSON.stringify(delivery);

    const record = {
      ...real.record,
      reobserved: [{ at: 0, conversation: event }],
      subject: { orchid: delivery.epoch + 1 },
    } satisfies MemoryRecordValue;

    yield* real.store.commit(delivery, [record]);
    model.written.add(event);
  }

  const records = yield* real.store.search("Orchid", "orchid");
  expect(records).toHaveLength(model.invalid ? 0 : 1);
  const rows = yield* real.sql.query("SELECT json FROM memories", []);
  expect(rows).toHaveLength(1);
  const [row] = rows;

  if (row === undefined) {
    return yield* Effect.die("Ledger lost a record");
  }

  const saved = yield* Schema.decodeEffect(Schema.fromJsonString(MemoryRecord))(
    row.json
  );

  expect(saved.reobserved).toHaveLength(model.written.size);
  expect(saved.uses).toHaveLength(model.used ? 1 : 0);
  expect(saved.stability_days).toBe(model.written.size);
  expect(saved.subject.orchid).toBe(model.epoch + 1);
  expect(saved.invalid_at !== null).toBe(model.invalid);

  return yield* Effect.void;
});

export const storeModel = Effect.fn("Remembers.test.storeModel")(
  function* storeModel(
    actions: readonly StoreAction[],
    record: MemoryRecordValue
  ) {
    const context = yield* Effect.context();
    const store = yield* Store;
    const cells = yield* SqlCells;
    const sql = yield* cells.project("orchid");

    const commands: AsyncCommand<Model, Real>[] = [
      "write" as const,
      "replay" as const,
      "use" as const,
      "use" as const,
      "advance" as const,
      "run" as const,
      "key" as const,
      "visit" as const,
      ...actions,
      "invalidate" as const,
      "advance" as const,
      "replay" as const,
    ].map((action) => ({
      check: () => true,
      run: Fn.flow(
        (model: Model, real: Real) => perform(action, model, real),
        Effect.runPromiseWith(context)
      ),
      toString: () => action,
    }));

    const setup = () => ({ model: initial(), real: { record, sql, store } });
    yield* Effect.promise(asyncModelRun.bind(null, setup, commands));
  }
);
