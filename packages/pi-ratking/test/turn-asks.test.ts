import { it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { modelRun } from "fast-check";
import type { Command } from "fast-check";
import { expect } from "vitest";

import { askTracker } from "../src/ask-tracker.ts";
import type { AskTracker } from "../src/ask-tracker.ts";

const Case = Schema.Struct({
  answered: Schema.Boolean,
  early: Schema.Boolean,
});

interface Model {
  count: number;
}

it.prop(
  "only unanswered admitted outbound asks count, including replies racing the send receipt and wrong-sender replies",
  [Arbitrary.schema(Schema.Array(Case).check(Schema.isMaxLength(100)))],
  ([samples]) => {
    const commands: Command<Model, AskTracker>[] = samples.map(
      (sample, index) => ({
        check: () => true,
        run: (model, real) => {
          const id = `ask-${index}`;

          if (sample.answered && sample.early) {
            real.answered(id, "peer");
          }

          real.answered(id, "stranger");
          real.admitted(id, "peer");

          if (sample.answered && !sample.early) {
            real.answered(id, "peer");
          }

          if (!sample.answered) {
            model.count += 1;
          }

          expect(real.count()).toBe(model.count);
        },
        toString: () => JSON.stringify(sample),
      })
    );

    modelRun(() => ({ model: { count: 0 }, real: askTracker() }), commands);
  }
);
