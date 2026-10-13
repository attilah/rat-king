// @effect-diagnostics asyncFunction:off -- fast-check's model runner is the Promise boundary.
import { it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import { asyncModelRun } from "fast-check";
import type { AsyncCommand } from "fast-check";
import { expect } from "vitest";

import { inbox } from "../src/pending.ts";

interface Model {
  readonly emitted: string[];
  readonly pending: Map<string, boolean>;
}

interface Real {
  readonly box: ReturnType<typeof inbox>;
  readonly emitted: string[];
}

const Operation = Schema.Struct({
  id: Schema.Literals(["a", "b", "c"]),
  kind: Schema.Literals(["take", "turn", "shown", "clear"]),
});

const step = (operation: typeof Operation.Type, model: Model, real: Real) => {
  const { id, kind } = operation;

  if (kind === "take") {
    if (!model.pending.has(id)) {
      model.pending.set(id, false);
    }

    real.box.take(
      { coalesce: true, content: id, details: { id }, id },
      "nextTurn"
    );
  }

  if (kind === "turn") {
    const due = [...model.pending].flatMap(([key, emitted]) =>
      emitted ? [] : [key]
    );

    if (due.length > 0) {
      model.emitted.push(
        due.length === 1 ? `single:${due.join(",")}` : `wake:${due.join(",")}`
      );
    }

    for (const key of due) {
      model.pending.set(key, true);
    }

    real.box.flushNext();
  }

  if (kind === "shown") {
    model.pending.delete(id);
    real.box.shown(id);
  }

  if (kind === "clear") {
    model.pending.clear();
    real.box.clear();
  }

  expect(real.emitted).toEqual(model.emitted);
};

it.effect.prop(
  "the wake buffer model survives interleaved arrivals, repeated turn hooks, display, clear and mailbox redelivery",
  [Arbitrary.schema(Schema.Array(Operation).check(Schema.isMaxLength(40)))],
  ([operations]) =>
    Effect.promise(async () => {
      const commands: AsyncCommand<Model, Real>[] = operations.map(
        (operation) => ({
          check: () => true,
          run: async (model, real) => {
            await Promise.resolve();
            step(operation, model, real);
          },
          toString: () => `${operation.kind} ${operation.id}`,
        })
      );

      await asyncModelRun(() => {
        const emitted: string[] = [];

        const box = inbox({
          digest: (mails, variant) => {
            emitted.push(
              `${variant}:${mails.map((mail) => mail.id).join(",")}`
            );
          },
          show: (mail) => {
            emitted.push(`single:${mail.id}`);
          },
        });

        return {
          model: { emitted: [], pending: new Map() },
          real: { box, emitted },
        };
      }, commands);
    })
);
