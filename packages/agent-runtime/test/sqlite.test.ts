/* oxlint-disable typescript/promise-function-async, promise/prefer-await-to-callbacks -- The upstream database transaction interface uses Promise callbacks. */
// @effect-diagnostics nodeBuiltinImport:off -- Node SQLite is a test host for the portable DO SQL facade.
// @effect-diagnostics asyncFunction:off -- Test adapter for pi-durable's async SQLite contract.
// @effect-diagnostics newPromise:off -- Deterministic Promise gates pause the upstream transaction callback.
/* oxlint-disable promise/avoid-new -- These gates expose an upstream Promise transaction without running an Effect runtime inside its callback. */
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { Harness, createRegistry } from "@earendil-works/pi-durable";
import type { TaskId } from "@earendil-works/pi-durable";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import type { SqliteExecutor } from "@earendil-works/pi-durable/storage/sqlite";
import { it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import { asyncModelRun } from "fast-check";
import type { AsyncCommand } from "fast-check";
import { expect } from "vitest";

import { piDurableLayer } from "../src/pi-durable.ts";
import { AgentHarness, Input, SubmissionId } from "../src/port.ts";
import { durableSqlite } from "../src/sqlite.ts";

class DatabaseFailure extends Schema.TaggedError<DatabaseFailure>()(
  "DatabaseFailure",
  {
    reason: Schema.String,
  }
) {}

const uninitialized = (): never => {
  throw new Error("Gate not initialized");
};

const deferred = <A>() => {
  let complete: (value: A) => void = uninitialized;

  const promise = new Promise<A>((resolve) => {
    complete = resolve;
  });

  return {
    promise,
    resolve: (value: A) => {
      complete(value);
    },
  };
};

const io = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    catch: (cause) => new DatabaseFailure({ reason: String(cause) }),
    try: run,
  });

const databaseFor = (host: DatabaseSync) =>
  durableSqlite({
    sql: {
      exec: (query, ...values) =>
        host
          .prepare(query)
          .all(
            ...values.map((value) =>
              value instanceof ArrayBuffer ? new Uint8Array(value) : value
            )
          ),
    },
    transaction: async (operation) => {
      host.exec("BEGIN");

      try {
        const result = await operation();
        host.exec("COMMIT");

        return result;
      } catch (error) {
        host.exec("ROLLBACK");
        throw error;
      }
    },
  });

it.effect(
  "SQLite facade queues outside reads, rolls back and expires transaction handles",
  () =>
    Effect.gen(function* proof() {
      const host = yield* Effect.acquireRelease(
        Effect.sync(() => new DatabaseSync(":memory:")),
        (owned) =>
          Effect.sync(() => {
            owned.close();
          })
      );

      const database = databaseFor(host);

      yield* io(() => database.exec("CREATE TABLE sample (value INTEGER)"));
      const entered = deferred<SqliteExecutor>();
      const release = deferred<boolean>();
      const rollback = new Error("roll back this transaction");

      const pending = database.transaction(async (tx) => {
        await tx.run("INSERT INTO sample VALUES (?)", 42);
        entered.resolve(tx);
        await release.promise;
        throw rollback;
      });

      const observed = pending.then(
        () => false,
        (error: unknown) => error === rollback
      );

      const handle = yield* io(() => entered.promise);
      const read = database.all("SELECT value FROM sample");
      yield* Effect.sync(() => {
        release.resolve(true);
      });
      expect(yield* io(() => observed)).toBe(true);
      expect(yield* io(() => read)).toEqual([]);
      expect(
        yield* io(() => handle.get("SELECT value FROM sample")).pipe(
          Effect.flip
        )
      ).toBeInstanceOf(DatabaseFailure);
      yield* io(() => database.run("INSERT INTO sample VALUES (?)", 7));
      expect(yield* io(() => database.all("SELECT value FROM sample"))).toEqual(
        [{ value: 7 }]
      );
      yield* io(() => database.close());
      expect(
        yield* io(() => database.get("SELECT value FROM sample")).pipe(
          Effect.flip
        )
      ).toBeInstanceOf(DatabaseFailure);
    })
);

const fixtureHost = Effect.gen(function* fixtureHost() {
  const directory = yield* Effect.acquireRelease(
    io(() => mkdtemp(path.join(tmpdir(), "rat-king-v1-"))),
    (owned) =>
      io(() => rm(owned, { force: true, recursive: true })).pipe(Effect.orDie)
  );

  const file = path.join(directory, "journal.sqlite");
  yield* io(() =>
    copyFile(
      path.join(import.meta.dirname, "fixtures", "pi-durable-1.0.2.sqlite"),
      file
    )
  );

  return yield* Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(file)),
    (owned) =>
      Effect.sync(() => {
        owned.close();
      })
  );
});

it.effect.prop(
  "v1 bytes migrate through the hosted SQLite facade without losing records or ordered cursor pages",
  {
    limit: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 3, minimum: 1 }))
    ),
    order: Arbitrary.schema(Schema.Literals(["ascending", "descending"])),
  },
  ({ limit, order }) =>
    Effect.gen(function* migrate() {
      const host = yield* fixtureHost;
      expect(host.prepare("SELECT version FROM durable_schema").all()).toEqual([
        { version: 1 },
      ]);

      const before = host
        .prepare("SELECT record FROM entries ORDER BY id")
        .all();

      const tasks = host.prepare("SELECT record FROM tasks ORDER BY id").all();

      const submissions = host
        .prepare("SELECT record FROM submissions ORDER BY id")
        .all();

      const storage = yield* io(() => SqliteStorage.open(databaseFor(host)));
      expect(
        host
          .prepare("SELECT version FROM durable_schema ORDER BY version")
          .all()
      ).toEqual([{ version: 2 }]);

      const conversations = yield* io(() =>
        storage.scanConversations({}, 10, undefined, BACKGROUND_CONTEXT)
      );

      const [conversation] = conversations.items;

      if (conversation === undefined) {
        throw new Error("Fixture conversation missing");
      }

      let page = yield* io(() =>
        storage.scanEntries(
          { conversationId: conversation.id, order },
          limit,
          undefined,
          BACKGROUND_CONTEXT
        )
      );

      const entries = [...page.items];

      while (page.next !== undefined) {
        const { next } = page;
        page = yield* io(() =>
          storage.scanEntries(
            { conversationId: conversation.id },
            limit,
            next,
            BACKGROUND_CONTEXT
          )
        );
        entries.push(...page.items);
      }

      const rows = entries.map((entry) => ({ record: JSON.stringify(entry) }));
      expect(order === "ascending" ? rows : rows.toReversed()).toEqual(before);
      expect(JSON.stringify(entries)).toContain("v1 journal question");
      expect(JSON.stringify(entries)).toContain("v1 journal answer");
      expect(
        host.prepare("SELECT record FROM tasks ORDER BY id").all()
      ).toEqual(tasks);
      expect(
        host.prepare("SELECT record FROM submissions ORDER BY id").all()
      ).toEqual(submissions);
      yield* io(() => storage.close(BACKGROUND_CONTEXT));
      const reopened = yield* io(() => SqliteStorage.open(databaseFor(host)));
      yield* Effect.gen(function* settled() {
        const harness = yield* AgentHarness;

        const input = yield* Schema.decodeEffect(Input)({
          content: "v1 journal question",
          requestId: "v1-fixture",
        });

        const id = yield* harness.submit(input);
        expect(yield* harness.wait(id)).toMatchObject({
          answer: "v1 journal answer",
          id,
        });
      }).pipe(
        Effect.provide(
          piDurableLayer(
            reopened,
            { models: createModels(), registry: createRegistry() },
            { modelId: "faux-1", provider: "faux" }
          )
        ),
        Effect.scoped
      );
    }),
  { arbitrary: { runs: 12 } }
);

interface CrashModel {
  restarts: number;
}

interface CrashHost {
  readonly host: DatabaseSync;
  readonly task: TaskId;
}

const crashCommand = (
  action: "crash" | "reopen"
): AsyncCommand<CrashModel, CrashHost> => ({
  check: (model) => action === "reopen" || model.restarts < 5,
  run: async (model, real) => {
    const storage = await SqliteStorage.open(databaseFor(real.host));

    if (action === "crash") {
      const record = await storage.task(real.task, BACKGROUND_CONTEXT);

      if (record === undefined) {
        throw new Error("Crash task missing");
      }

      await storage.commit(
        [
          {
            type: "task",
            value: {
              ...record,
              state: { checkpoint: { phase: "run" }, status: "running" },
            },
          },
        ],
        BACKGROUND_CONTEXT
      );
      model.restarts += 1;
    }

    const harness = await Harness.open(
      storage,
      { models: createModels(), registry: createRegistry() },
      BACKGROUND_CONTEXT
    );

    try {
      const inspection = await harness.inspect(BACKGROUND_CONTEXT);

      const task = inspection.tasks.find(
        ({ record }) => record.id === real.task
      );

      expect(task?.record.restarts).toBe(model.restarts);
      expect(task?.state).toMatchObject({
        kind: "blocked",
        reason: model.restarts >= 5 ? "restart_limit" : "missing_task",
      });
    } finally {
      await harness.close(BACKGROUND_CONTEXT);
    }
  },
  toString: () => action,
});

it.effect.prop(
  "five crash recoveries park a task across clean reopens and every adapter operation fails loudly",
  [
    Arbitrary.schema(
      Schema.Array(Schema.Literals(["crash", "reopen"])).check(
        Schema.isMaxLength(10)
      )
    ),
  ],
  ([actions]) =>
    Effect.gen(function* crashLoop() {
      const host = yield* fixtureHost;
      const storage = yield* io(() => SqliteStorage.open(databaseFor(host)));

      const conversations = yield* io(() =>
        storage.scanConversations({}, 1, undefined, BACKGROUND_CONTEXT)
      );

      const [conversation] = conversations.items;

      if (conversation === undefined) {
        throw new Error("Fixture conversation missing");
      }

      const task = yield* io(() => storage.mintId<TaskId<null>>());
      yield* io(() =>
        storage.commit(
          [
            {
              type: "task",
              value: {
                abortRequested: false,
                background: false,
                conversationId: conversation.id,
                id: task,
                input: null,
                kind: "fixture.crash",
                restarts: 0,
                state: { checkpoint: { phase: "run" }, status: "pending" },
                version: 1,
              },
            },
          ],
          BACKGROUND_CONTEXT
        )
      );
      yield* io(() => storage.close(BACKGROUND_CONTEXT));
      const setup = { model: { restarts: 0 }, real: { host, task } };

      const commands = [
        ...actions.map(crashCommand),
        ...Array.from({ length: 5 }, () => crashCommand("crash")),
        crashCommand("reopen"),
      ];

      yield* io(() => asyncModelRun(() => setup, commands));
      expect(setup.model.restarts).toBe(5);
      const parked = yield* io(() => SqliteStorage.open(databaseFor(host)));
      yield* Effect.gen(function* refusesProgress() {
        const harness = yield* AgentHarness;

        const input = yield* Schema.decodeEffect(Input)({
          content: "must not queue",
          requestId: "parked",
        });

        for (const operation of [
          harness.resume(),
          harness.submit(input),
          harness.wait(SubmissionId.make(8)),
        ]) {
          const failure = yield* operation.pipe(Effect.flip);
          expect(failure.operation).toBe("restart_limit");
          expect(failure.reason).toContain(String(task));
          expect(failure.reason).toContain("retryTask()");
        }
      }).pipe(
        Effect.provide(
          piDurableLayer(
            parked,
            { models: createModels(), registry: createRegistry() },
            { modelId: "faux-1", provider: "faux" }
          )
        ),
        Effect.scoped
      );
      expect(
        host
          .prepare(
            "SELECT request_id FROM submissions WHERE request_id = 'parked'"
          )
          .all()
      ).toEqual([]);
    }),
  { arbitrary: { runs: 12 } }
);
