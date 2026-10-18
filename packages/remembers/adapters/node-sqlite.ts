import { DatabaseSync } from "node:sqlite";

import { Effect, Exit, Layer, Schema, Semaphore } from "effect";

import { Failure } from "../src/contract.ts";
import { SqlCells } from "./sqlite.ts";
import type { Sql } from "./sqlite.ts";

const Rows = Schema.Array(Schema.Struct({ json: Schema.String }));

const io = <A>(operation: () => A) =>
  Effect.try({
    catch: () => new Failure({ code: "sqlite", operation: "database" }),
    try: operation,
  });

export const databaseSql = (database: DatabaseSync): Sql => {
  const lock = Semaphore.makeUnsafe(1);

  const sql: Sql = {
    execute: (text, values) =>
      io(() => {
        if (values.length === 0) {
          database.exec(text);
        } else {
          database.prepare(text).run(...values);
        }
      }),
    query: (text, values) =>
      io(() => database.prepare(text).all(...values)).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Rows)),
        Effect.mapError(
          () => new Failure({ code: "sqlite_rows", operation: "query" })
        )
      ),
    transaction: (job) =>
      lock.withPermit(
        Effect.acquireUseRelease(
          sql.execute("BEGIN IMMEDIATE", []),
          () => job(sql),
          (_resource, exit) =>
            sql.execute(Exit.isSuccess(exit) ? "COMMIT" : "ROLLBACK", [])
        )
      ),
  };

  return sql;
};

export const nodeCells = (
  controlPath: string,
  projects: ReadonlyMap<string, string>,
  readOnly = false
) =>
  Layer.effect(
    SqlCells,
    Effect.gen(function* makeNodeCells() {
      const opened = new Map<string, Sql>();

      const acquire = Effect.fn("Remembers.node.acquire")(function* acquire(
        path: string
      ) {
        const database = yield* Effect.acquireRelease(
          Effect.try({
            catch: () =>
              new Failure({ code: "sqlite_open", operation: "open" }),
            try: () => new DatabaseSync(path, { readOnly }),
          }),
          (db) =>
            Effect.sync(() => {
              db.close();
            })
        );

        return databaseSql(database);
      });

      const control = yield* acquire(controlPath);

      for (const [name, path] of projects) {
        opened.set(name, yield* acquire(path));
      }

      return SqlCells.of({
        control: () => Effect.succeed(control),
        project: (name) => {
          const sql = opened.get(name);

          return sql
            ? Effect.succeed(sql)
            : Effect.fail(
                new Failure({ code: "unknown_project", operation: "project" })
              );
        },
        projects: () => Effect.succeed([...opened.keys()]),
      });
    })
  );
