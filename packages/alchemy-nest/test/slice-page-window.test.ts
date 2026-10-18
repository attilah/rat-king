import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";

import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Arbitrary, Effect, FileSystem, Schema } from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { SliceSource } from "../src/slice-source.ts";
import { sqliteSliceSource } from "../src/slice-sqlite.ts";
import { fixtureNow } from "./slice-fixtures.ts";

const original = `WITH activity AS (
 SELECT runs.conversation_id, max(chunks.started_at) AS latest FROM chunks JOIN runs ON chunks.run_id=runs.run_id GROUP BY runs.conversation_id
), prefix AS (
 SELECT chunks.rowid AS rowid, chunks.chunk_id, runs.conversation_id AS conversation, chunks.role, chunks.started_at, chunks.token_count, activity.latest
 FROM chunks JOIN runs ON chunks.run_id=runs.run_id JOIN activity ON activity.conversation_id=runs.conversation_id
 WHERE chunks.rowid > ? ORDER BY chunks.rowid LIMIT ?
)
SELECT rowid, chunk_id, conversation, role, started_at, token_count FROM prefix
WHERE rowid < coalesce((SELECT min(rowid) FROM prefix WHERE latest >= ?), 9223372036854775807) ORDER BY rowid`;

const fixture = Effect.fn("Test.pageWindow.fixture")(function* fixture(
  size: number,
  active: number
) {
  const fs = yield* FileSystem.FileSystem;
  const directory = yield* fs.makeTempDirectoryScoped();
  const path = `${directory}/window.db`;
  yield* Effect.sync(() => {
    const db = new DatabaseSync(path);

    try {
      db.exec(`CREATE TABLE runs(run_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL);
CREATE INDEX conversation_runs ON runs(conversation_id);
CREATE TABLE chunks(chunk_id TEXT UNIQUE, run_id TEXT, chunk_idx INTEGER, role TEXT, text TEXT, started_at INTEGER, token_count INTEGER, UNIQUE(run_id, chunk_idx));
BEGIN;`);
      const run = db.prepare("INSERT INTO runs VALUES (?, ?)");

      const chunk = db.prepare(
        "INSERT INTO chunks VALUES (?, ?, ?, 'user', 'invented', ?, 1)"
      );

      for (let index = 0; index < size; index += 1) {
        const conversation = index % Math.min(50_000, size / 3);
        run.run(`run-${index}`, `conversation-${conversation}`);
        chunk.run(
          `chunk-${index}`,
          `run-${index}`,
          0,
          conversation === active && index >= (size * 2) / 3
            ? fixtureNow
            : fixtureNow - 10_000
        );
      }

      db.exec("COMMIT; ANALYZE;");
    } finally {
      db.close();
    }
  });

  return path;
});

it.effect.prop(
  "windowed activity preserves the old contiguous idle prefix and cursor even when activity is outside the page",
  {
    active: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 63, minimum: 0 }))
    ),
    after: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 128, minimum: 0 }))
    ),
    limit: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 2000, minimum: 1 }))
    ),
  },
  ({ active, after, limit }) =>
    Effect.gen(function* equivalence() {
      const path = yield* fixture(192, active);
      yield* TestClock.setTime(fixtureNow);
      const db = new DatabaseSync(path);

      const expected = db
        .prepare(original)
        .all(after, limit, fixtureNow - 1000);

      db.close();

      const result = yield* Effect.gen(function* page() {
        return yield* (yield* SliceSource).chunks(after, limit, 1000);
      }).pipe(Effect.provide(sqliteSliceSource(path, 30)));

      expect(result.items).toEqual(expected);
      expect(result.next).toBe(expected.at(-1)?.rowid ?? after);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 12 } }
);

it.effect.prop(
  "a 2000 chunk page stays below one second on a generated store with at least 200000 chunks",
  {
    extra: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 10_000, minimum: 0 }))
    ),
  },
  ({ extra }) =>
    Effect.gen(function* timing() {
      const path = yield* fixture(200_000 + extra, -1);
      yield* TestClock.setTime(fixtureNow);
      yield* Effect.gen(function* measure() {
        const source = yield* SliceSource;
        const start = performance.now();
        const result = yield* source.chunks(0, 2000, 1000);
        const elapsed = performance.now() - start;
        expect(result.items).toHaveLength(2000);
        expect(elapsed).toBeLessThan(1000);
      }).pipe(Effect.provide(sqliteSliceSource(path, 30)));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 3 }, timeout: 15_000 }
);
