import { it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import * as fc from "fast-check";
import { expect } from "vitest";

import {
  HANDOFF_HISTORY_CAPACITY,
  handoffHistory,
} from "../../mailbox-client/src/handoff-history.ts";

const Operation = Schema.Struct({
  action: Schema.Literals(["add", "read", "delete"]),
  key: Schema.Int.check(Schema.isBetween({ maximum: 2200, minimum: 0 })),
});

it.prop(
  "past capacity handoff replay history stays bounded and dedupes its recent window",
  [
    Schema.Int.check(Schema.isBetween({ maximum: 64, minimum: 1 })),
    Arbitrary.schema(Schema.Array(Operation).check(Schema.isMaxLength(40))),
  ],
  ([extra, operations]) => {
    const history = handoffHistory();
    const count = HANDOFF_HISTORY_CAPACITY + extra;

    for (let index = 0; index < count; index += 1) {
      history.add(String(index));
      expect(history.size()).toBeLessThanOrEqual(HANDOFF_HISTORY_CAPACITY);
    }

    const recent = Array.from(
      { length: HANDOFF_HISTORY_CAPACITY },
      (_, index) => String(extra + index)
    );

    expect(history.size()).toBe(HANDOFF_HISTORY_CAPACITY);
    expect(history.has("0")).toBe(false);

    for (const key of recent) {
      expect(history.has(key)).toBe(true);
    }

    const sequence: (typeof Operation.Type)[] = [
      { action: "read", key: extra },
      { action: "add", key: count },
      { action: "read", key: extra },
      { action: "read", key: extra + 1 },
      ...operations,
    ];

    const commands: fc.Command<{ order: string[] }, typeof history>[] =
      sequence.map((operation) => ({
        check: () => true,
        run: (model, real) => {
          const key = String(operation.key);
          const present = model.order.includes(key);

          if (operation.action === "read") {
            expect(real.has(key)).toBe(present);
          }

          if (operation.action === "delete") {
            expect(real.delete(key)).toBe(present);
          }

          if (operation.action === "add") {
            real.add(key);
          }

          if (operation.action === "delete") {
            model.order = model.order.filter((entry) => entry !== key);
          } else if (operation.action === "add" || present) {
            model.order = [
              ...model.order.filter((entry) => entry !== key),
              key,
            ].slice(-HANDOFF_HISTORY_CAPACITY);
          }

          expect(real.size()).toBe(model.order.length);
          expect(real.size()).toBeLessThanOrEqual(HANDOFF_HISTORY_CAPACITY);
        },
        toString: () => JSON.stringify(operation),
      }));

    fc.modelRun(() => ({ model: { order: recent }, real: history }), commands);
  },
  { arbitrary: { runs: 12 } }
);
