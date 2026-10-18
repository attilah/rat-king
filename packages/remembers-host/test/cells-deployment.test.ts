import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { GeneratedConfiguration } from "@rat-king/alchemy-nest";
import { Failure, Store } from "@rat-king/remembers";
import { SqlCells, sqliteStore } from "@rat-king/remembers/sqlite";
import { Effect, Exit, FileSystem, Layer, Schema } from "effect";
import { expect } from "vitest";

import { hostCells } from "../src/cells.ts";
import {
  buildWorker,
  configurationWithBindings,
  workerPrivateKeys,
} from "../src/deployment.ts";

it.effect(
  "host cells stay in a private instance data directory, use WAL and roll back actual SQLite transactions",
  () =>
    Effect.gen(function* cellBindings() {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped();
      yield* fs.makeDirectory(`${root}/remembers`, { mode: 0o700 });
      yield* Effect.gen(function* checks() {
        const cells = yield* SqlCells;
        const control = yield* cells.control();

        const [journal] = yield* control.query(
          "SELECT json_quote(journal_mode) AS json FROM pragma_journal_mode",
          []
        );

        expect(journal?.json).toBe('"wal"');

        const rolledBack = yield* Effect.exit(
          control.transaction((sql) =>
            Effect.gen(function* rollback() {
              yield* sql.execute(
                "INSERT INTO control(id,json) VALUES ('cursor','\"not-committed\"')",
                []
              );

              return yield* new Failure({
                code: "fixture",
                operation: "rollback",
              });
            })
          )
        );

        expect(Exit.isFailure(rolledBack)).toBe(true);
        expect(yield* (yield* Store).cursor()).toBe("");
        expect(yield* cells.projects()).toEqual(["orchid", "violet"]);
        expect(
          (yield* fs.stat(`${root}/remembers/control.sqlite`)).mode % 0o1000
        ).toBe(0o600);
        expect(
          (yield* fs.readDirectory(`${root}/remembers`)).filter((name) =>
            name.endsWith(".sqlite")
          )
        ).toHaveLength(3);
      }).pipe(
        Effect.provide(
          sqliteStore.pipe(
            Layer.provideMerge(hostCells(root, ["orchid", "violet"]))
          )
        )
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

it.effect(
  "the offline worker bundle reuses the celld provider contract and enables call only on its own deployment",
  () =>
    Effect.gen(function* bundle() {
      const entry = new URL("../src/worker-entry.ts", import.meta.url).pathname;
      const built = yield* buildWorker(entry, "0.1.0", "a".repeat(40));

      const configuration = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(GeneratedConfiguration)
      )(built.configuration);

      expect(configuration.vars).toEqual({
        MISCHIEF_STEP_KINDS: "call",
      });
      expect(
        configuration.durable_objects.bindings.map((binding) => binding.name)
      ).toEqual(["PLAN_RUN", "POSTBOX", "SCHEDULE", "SERVICE_TOKENS"]);
      expect(
        workerPrivateKeys.every((key) => configuration.vars[key] === undefined)
      ).toBe(true);
      expect(built.bundle).toContain("createHostWorker");
      expect(configurationWithBindings(configuration, "a".repeat(64))).not.toBe(
        configurationWithBindings(configuration, "b".repeat(64))
      );
    })
);
