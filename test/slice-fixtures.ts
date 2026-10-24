import { DatabaseSync } from "node:sqlite";

import { Effect, FileSystem } from "effect";

export const fixtureNow = 1_800_000_000_000;

export const makeSliceFixture = Effect.fn("Test.slice.fixture")(
  function* fixture(text: string) {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped();
    const path = `${directory}/sessions.db`;
    yield* Effect.sync(() => {
      const db = new DatabaseSync(path);

      try {
        db.exec(`CREATE TABLE runs(run_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL);
        CREATE TABLE chunks(chunk_id TEXT UNIQUE, run_id TEXT, chunk_idx INTEGER, role TEXT, text TEXT, started_at INTEGER, token_count INTEGER, UNIQUE(run_id, chunk_idx));
        INSERT INTO runs VALUES ('run-a','conversation-a'),('run-b','conversation-a'),('run-c','conversation-b'),('run-d','conversation-c');`);
        const insert = db.prepare("INSERT INTO chunks VALUES (?,?,?,?,?,?,?)");
        insert.run("first", "run-a", 0, "user", text, fixtureNow - 20_000, 10);
        insert.run(
          "active-early",
          "run-c",
          0,
          "user",
          "active early",
          fixtureNow - 10_000,
          10
        );
        insert.run(
          "last",
          "run-b",
          0,
          "assistant",
          "literal_100% MixedCase",
          fixtureNow - 5000,
          20
        );
        insert.run(
          "active-late",
          "run-c",
          1,
          "assistant",
          "literalX100Z MixedCase",
          fixtureNow - 500,
          10
        );
        insert.run(
          "other",
          "run-d",
          0,
          "assistant",
          "literal_100% MixedCase",
          fixtureNow - 3000,
          15
        );
      } finally {
        db.close();
      }
    });

    return path;
  }
);
