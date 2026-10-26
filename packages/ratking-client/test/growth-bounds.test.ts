import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Arbitrary, Effect, FileSystem, Path, Schema } from "effect";
import * as fc from "fast-check";
import { expect } from "vitest";

import { openAsks, CLOSED_ASK_HISTORY } from "../src/asks.ts";
import type { PendingAskValue } from "../src/asks.ts";
import { FILTER_HIT_HISTORY, nextFilterHits } from "../src/attention.ts";
import { appendLog, LOG_MAX_BYTES, LOG_ARCHIVES } from "../src/log.ts";
import { recentMap } from "../src/recent.ts";

const Step = Schema.Struct({
  key: Schema.Int.check(Schema.isBetween({ maximum: 12, minimum: 0 })),
  read: Schema.Boolean,
});

it.prop(
  "synchronous hint caches follow a bounded LRU model",
  [
    Arbitrary.schema(Schema.Array(Step).check(Schema.isMaxLength(100))),
    Schema.Int.check(Schema.isBetween({ maximum: 8, minimum: 1 })),
  ],
  ([steps, capacity]) => {
    const actual = recentMap<number, number>(capacity);

    const commands: fc.Command<{ order: number[] }, typeof actual>[] =
      steps.map((step) => ({
        check: () => true,
        run: (model, real) => {
          const present = model.order.includes(step.key);

          if (step.read) {
            expect(real.get(step.key)).toBe(present ? step.key : undefined);
          } else {
            real.set(step.key, step.key);
          }

          if (present || !step.read) {
            model.order = [
              ...model.order.filter((key) => key !== step.key),
              step.key,
            ].slice(-capacity);
          }

          expect(real.size()).toBe(model.order.length);
          expect(real.size()).toBeLessThanOrEqual(capacity);
        },
        toString: () => JSON.stringify(step),
      }));

    fc.modelRun(() => ({ model: { order: [] }, real: actual }), commands);
  }
);

const ask = (id: string, state: PendingAskValue["state"]): PendingAskValue => ({
  did: "did:web:peer.invalid",
  id,
  sentAt: 0,
  state,
  summary: "synthetic",
  to: "peer",
});

it.effect.prop(
  "closed ask history is bounded across load and writes; open obligations survive",
  [Schema.Int.check(Schema.isBetween({ maximum: 30, minimum: 1 }))],
  ([extra]) =>
    Effect.gen(function* proof() {
      let disk = [
        ...Array.from({ length: CLOSED_ASK_HISTORY + extra }, (_, index) =>
          ask(String(index), "closed")
        ),
        ask("open", "pending"),
      ];

      const open = openAsks({
        load: Effect.sync(() => disk),
        now: Effect.succeed(0),
        save: (entries) =>
          Effect.sync(() => {
            disk = [...entries];
          }),
      });

      const journal = yield* open;
      expect(disk.filter((entry) => entry.state === "closed")).toHaveLength(
        CLOSED_ASK_HISTORY
      );
      expect((yield* journal.pending).map((entry) => entry.id)).toEqual([
        "open",
      ]);
      yield* journal.record(ask("new", "closed"));
      expect(disk.filter((entry) => entry.state === "closed")).toHaveLength(
        CLOSED_ASK_HISTORY
      );
      expect(disk.some((entry) => entry.id === "new")).toBe(true);
      expect((yield* (yield* open).pending).map((entry) => entry.id)).toEqual([
        "open",
      ]);
    }),
  { arbitrary: { runs: 8 } }
);

it.prop(
  "advisory filter counters retain a finite recent history and saturate safely",
  [Schema.Int.check(Schema.isBetween({ maximum: 30, minimum: 1 }))],
  ([extra]) => {
    let hits: Record<string, number> = {};

    for (let index = 0; index < FILTER_HIT_HISTORY + extra; index += 1) {
      hits = nextFilterHits(hits, `rule-${index}`);
    }

    expect(Object.keys(hits)).toHaveLength(FILTER_HIT_HISTORY);
    expect(hits["rule-0"]).toBeUndefined();
    expect(nextFilterHits({ full: Number.MAX_SAFE_INTEGER }, "full").full).toBe(
      Number.MAX_SAFE_INTEGER
    );
  },
  { arbitrary: { runs: 8 } }
);

it.effect(
  "diagnostic writes rotate under one lock and bound oversized records",
  () =>
    Effect.gen(function* proof() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();
      const file = path.join(root, "client.log");

      for (let index = 0; index < 5; index += 1) {
        yield* appendLog(file, [String(index).repeat(LOG_MAX_BYTES - 1)]);
      }

      expect(Number((yield* fs.stat(file)).size)).toBe(LOG_MAX_BYTES);
      expect((yield* fs.readFileString(`${file}.1`)).startsWith("3")).toBe(
        true
      );
      expect((yield* fs.readFileString(`${file}.2`)).startsWith("2")).toBe(
        true
      );
      expect(yield* fs.exists(`${file}.${LOG_ARCHIVES + 1}`)).toBe(false);
      yield* appendLog(file, ["x".repeat(LOG_MAX_BYTES + 1)]);
      expect(yield* fs.readFileString(file)).toContain(
        "Oversized client diagnostic omitted"
      );

      for (const name of [file, `${file}.1`, `${file}.2`]) {
        expect((yield* fs.stat(name)).mode % 0o1000).toBe(0o600);
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
