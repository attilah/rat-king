import { DatabaseSync } from "node:sqlite";

import { Failure, RunBooks } from "@rat-king/remembers";
import { databaseSql } from "@rat-king/remembers/node-sqlite";
import { sha256 } from "@rat-king/remembers/pipeline";
import { SqlCells } from "@rat-king/remembers/sqlite";
import { Effect, FileSystem, Layer, Schema } from "effect";

const failed = () =>
  new Failure({ code: "private_database", operation: "cells" });

export const hostCells = (root: string, projects: readonly string[]) =>
  Layer.effect(
    SqlCells,
    Effect.gen(function* bindCells() {
      const fs = yield* FileSystem.FileSystem;
      const directory = `${root}/remembers`;
      const info = yield* fs.stat(directory).pipe(Effect.mapError(failed));

      if (
        info.type !== "Directory" ||
        info.mode % 0o1000 !== 0o700 ||
        (yield* fs.realPath(directory).pipe(Effect.mapError(failed))) !==
          directory
      ) {
        return yield* failed();
      }

      const open = Effect.fn("RemembersHost.openCell")(function* open(
        name: string
      ) {
        const path = `${directory}/${name}.sqlite`;

        const entries = yield* fs
          .readDirectory(directory)
          .pipe(Effect.mapError(failed));

        if (
          entries.includes(`${name}.sqlite`) &&
          (yield* fs.realPath(path).pipe(Effect.mapError(failed))) !== path
        ) {
          return yield* failed();
        }

        const db = yield* Effect.acquireRelease(
          Effect.try({
            catch: failed,
            try: () => {
              const database = new DatabaseSync(path);

              try {
                database.exec(
                  "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;"
                );

                return database;
              } catch (error) {
                database.close();
                throw error;
              }
            },
          }),
          (database) =>
            Effect.sync(() => {
              database.close();
            })
        );

        yield* fs.chmod(path, 0o600).pipe(Effect.mapError(failed));

        return databaseSql(db);
      });

      const control = yield* open("control");
      const cells = new Map<string, ReturnType<typeof databaseSql>>();

      for (const project of projects) {
        cells.set(project, yield* open(`project-${yield* sha256(project)}`));
      }

      return SqlCells.of({
        control: () => Effect.succeed(control),
        project: (name) => {
          const sql = cells.get(name);

          return sql === undefined
            ? Effect.fail(failed())
            : Effect.succeed(sql);
        },
        projects: () => Effect.succeed([...cells.keys()]),
      });
    })
  );

export const completedRun = Effect.fn("RemembersHost.completed")(
  function* completedRun(runId: string) {
    const sql = yield* (yield* SqlCells).control();

    const [row] = yield* sql.query(
      "SELECT json FROM runs WHERE id GLOB ? AND done=1 ORDER BY id LIMIT 1",
      [runId]
    );

    return row === undefined
      ? null
      : yield* Schema.decodeUnknownEffect(Schema.fromJsonString(RunBooks))(
          row.json
        ).pipe(Effect.mapError(failed));
  }
);
