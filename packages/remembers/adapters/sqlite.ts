import { Context, Effect, Layer, Schema } from "effect";

import { Failure, MemoryRecord, Store, safePrivacy } from "../src/contract.ts";
import type {
  DeliveryValue,
  Job,
  DefectValue,
  MemoryRecordValue,
} from "../src/contract.ts";

export interface Sql {
  readonly execute: (
    text: string,
    values: readonly (string | number | null)[]
  ) => Job<void>;
  readonly query: (
    text: string,
    values: readonly (string | number | null)[]
  ) => Job<readonly { readonly json: string }[]>;
  readonly transaction: <A>(job: (sql: Sql) => Job<A>) => Job<A>;
}

export class SqlCells extends Context.Service<
  SqlCells,
  {
    readonly control: () => Job<Sql>;
    readonly project: (name: string) => Job<Sql>;
    readonly projects: () => Job<readonly string[]>;
  }
>()("remembers/SqlCells") {}

const controlDdl =
  "CREATE TABLE IF NOT EXISTS control (id TEXT PRIMARY KEY, json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, done INTEGER NOT NULL DEFAULT 0, json TEXT NOT NULL DEFAULT '{}'); CREATE TABLE IF NOT EXISTS fired (id TEXT PRIMARY KEY);";

const projectDdl =
  "CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, json TEXT NOT NULL); CREATE VIRTUAL TABLE IF NOT EXISTS memory_search USING fts5(id UNINDEXED, sentence, concepts); CREATE TABLE IF NOT EXISTS writes (id TEXT PRIMARY KEY, json TEXT NOT NULL);";

const parse =
  <A>(schema: Schema.Codec<A>) =>
  (row: { readonly json: string }): Job<A> =>
    Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(row.json).pipe(
      Effect.mapError(
        () => new Failure({ code: "persisted_schema", operation: "sqlite" })
      )
    );

const mergeRecord = (
  old: MemoryRecordValue,
  next: MemoryRecordValue
): MemoryRecordValue => {
  const observations = new Map(
    old.reobserved.map((item) => [JSON.stringify(item), item])
  );

  for (const item of next.reobserved) {
    observations.set(JSON.stringify(item), item);
  }

  const cites = new Map(old.cites.map((item) => [JSON.stringify(item), item]));

  for (const item of next.cites) {
    cites.set(JSON.stringify(item), item);
  }

  return MemoryRecord.make({
    ...old,
    cites: [
      old.cites[0],
      ...[...cites.values()].filter(
        (cite) => JSON.stringify(cite) !== JSON.stringify(old.cites[0])
      ),
    ],
    invalid_at: old.invalid_at ?? next.invalid_at,
    reobserved: [
      old.reobserved[0],
      ...[...observations.values()].filter(
        (item) => JSON.stringify(item) !== JSON.stringify(old.reobserved[0])
      ),
    ],
    stability_days:
      old.stability_days + observations.size - old.reobserved.length,
    subject: Object.fromEntries(
      [
        ...new Set([...Object.keys(old.subject), ...Object.keys(next.subject)]),
      ].map((key) => [
        key,
        Math.max(old.subject[key] ?? 0, next.subject[key] ?? 0),
      ])
    ),
  });
};

const commitRecords = Effect.fn("Remembers.sqlite.commitRecords")(
  function* commitRecords(
    sql: Sql,
    identity: DeliveryValue,
    records: readonly MemoryRecordValue[]
  ) {
    const key = JSON.stringify(identity);

    const previous = yield* sql.query("SELECT json FROM writes WHERE id = ?", [
      key,
    ]);

    const [receipt] = previous;

    if (receipt) {
      return yield* parse(Schema.Int)(receipt);
    }

    for (const record of records) {
      if (!safePrivacy(record.claim)) {
        return yield* Effect.fail(
          new Failure({ code: "privacy", operation: "commit" })
        );
      }

      const [existing] = yield* sql.query(
        "SELECT json FROM memories WHERE id = ?",
        [record.id]
      );

      const stored = existing
        ? mergeRecord(yield* parse(MemoryRecord)(existing), record)
        : record;

      yield* sql.execute(
        "INSERT INTO memories(id,json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json = excluded.json",
        [record.id, JSON.stringify(stored)]
      );

      if (!existing) {
        yield* sql.execute(
          "INSERT INTO memory_search(id,sentence,concepts) VALUES (?,?,?)",
          [record.id, record.claim.sentence, record.claim.concepts.join(" ")]
        );
      }
    }

    yield* sql.execute("INSERT INTO writes(id,json) VALUES (?,?)", [
      key,
      JSON.stringify(records.length),
    ]);

    return records.length;
  }
);

export const sqliteLayer = (initialize = true) =>
  Layer.effect(
    Store,
    Effect.gen(function* makeSqliteStore() {
      const cells = yield* SqlCells;
      const control = yield* cells.control();

      if (initialize) {
        yield* control.execute(controlDdl, []);
      }

      const project = Effect.fn("Remembers.sqlite.project")(function* project(
        name: string
      ) {
        const sql = yield* cells.project(name);

        if (initialize) {
          yield* sql.execute(projectDdl, []);
        }

        return sql;
      });

      const allRecords = Effect.fn("Remembers.sqlite.allRecords")(
        function* allRecords() {
          const records: MemoryRecordValue[] = [];

          for (const name of yield* cells.projects()) {
            const sql = yield* project(name);
            records.push(
              ...(yield* Effect.forEach(parse(MemoryRecord))(
                yield* sql.query("SELECT json FROM memories", [])
              ))
            );
          }

          return records;
        }
      );

      return Store.of({
        commit: Effect.fn("Remembers.sqlite.commit")(
          function* commit(identity, input) {
            const records = yield* Schema.decodeUnknownEffect(
              Schema.Array(MemoryRecord)
            )(input).pipe(
              Effect.mapError(
                () => new Failure({ code: "schema", operation: "commit" })
              )
            );

            const groups = new Map<string, MemoryRecordValue[]>();

            for (const record of records) {
              const group = groups.get(record.claim.project) ?? [];
              group.push(record);
              groups.set(record.claim.project, group);
            }

            let count = 0;

            for (const [name, group] of groups) {
              const sql = yield* project(name);
              count += yield* sql.transaction((tx) =>
                commitRecords(tx, identity, group)
              );
            }

            return count;
          }
        ),
        cursor: Effect.fn("Remembers.sqlite.cursor")(function* cursor() {
          const [row] = yield* control.query(
            "SELECT json FROM control WHERE id = 'cursor'",
            []
          );

          return row ? yield* parse(Schema.String)(row) : "";
        }),
        defects: Effect.fn("Remembers.sqlite.defects")(function* defects() {
          const grouped = new Map<string, DefectValue>();

          for (const record of yield* allRecords()) {
            const { defect } = record.claim;

            if (defect !== null) {
              grouped.set(defect.id, defect);
            }
          }

          return [...grouped.values()];
        }),
        finish: (runId, cursor, books) =>
          control.transaction((tx) =>
            Effect.gen(function* finish() {
              yield* tx.execute(
                "UPDATE runs SET done = 1, json = ? WHERE id = ?",
                [JSON.stringify(books), runId]
              );
              yield* tx.execute(
                "INSERT INTO control(id,json) VALUES ('cursor',?) ON CONFLICT(id) DO UPDATE SET json = excluded.json",
                [JSON.stringify(cursor)]
              );
            })
          ),
        fired: (id) =>
          control
            .query("SELECT json_quote(id) AS json FROM fired WHERE id = ?", [
              id,
            ])
            .pipe(Effect.map((rows) => rows.length > 0)),
        markFired: (id) =>
          control.execute("INSERT OR IGNORE INTO fired(id) VALUES (?)", [id]),
        owed: () =>
          control
            .query("SELECT json_quote(id) AS json FROM runs WHERE done = 0", [])
            .pipe(
              Effect.flatMap((rows) =>
                Effect.forEach(parse(Schema.String))(rows)
              )
            ),
        search: Effect.fn("Remembers.sqlite.search")(
          function* search(text, scope) {
            const projects = yield* cells.projects();

            const names =
              scope === null
                ? projects
                : [scope, ...projects.filter((name) => name !== scope)];

            const tokens = text.match(/[\p{L}\p{N}_-]+/gu) ?? [];

            if (tokens.length === 0) {
              return [];
            }

            const query = tokens.map((token) => `"${token}"`).join(" OR ");
            const matches: MemoryRecordValue[] = [];

            for (const name of names) {
              if (!projects.includes(name)) {
                continue;
              }

              const sql = yield* project(name);

              const rows = yield* sql.query(
                "SELECT memories.json AS json FROM memory_search JOIN memories ON memories.id = memory_search.id WHERE memory_search MATCH ? AND json_extract(memories.json, '$.invalid_at') IS NULL ORDER BY bm25(memory_search) LIMIT 100",
                [query]
              );

              const valid = (yield* Effect.forEach(parse(MemoryRecord))(
                rows
              )).filter(
                (record) =>
                  record.invalid_at === null && safePrivacy(record.claim)
              );

              if (name === scope && valid.length > 0) {
                return valid;
              }

              matches.push(...valid);
            }

            return matches.filter(
              (record) =>
                record.invalid_at === null && safePrivacy(record.claim)
            );
          }
        ),
        start: (runId) =>
          control.execute("INSERT OR IGNORE INTO runs(id) VALUES (?)", [runId]),
        use: (name, id, useId, at) =>
          Effect.gen(function* use() {
            const sql = yield* project(name);
            yield* sql.transaction((tx) =>
              Effect.gen(function* useTransaction() {
                const [row] = yield* tx.query(
                  "SELECT json FROM memories WHERE id = ?",
                  [id]
                );

                if (!row) {
                  return yield* new Failure({
                    code: "missing",
                    operation: "use",
                  });
                }

                const record = yield* parse(MemoryRecord)(row);

                if (record.uses.some((item) => item.id === useId)) {
                  return yield* Effect.void;
                }

                return yield* tx.execute(
                  "UPDATE memories SET json = ? WHERE id = ?",
                  [
                    JSON.stringify({
                      ...record,
                      uses: [...record.uses, { at, id: useId }],
                    }),
                    id,
                  ]
                );
              })
            );
          }),
      });
    })
  );

export const sqliteStore = sqliteLayer();
