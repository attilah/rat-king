import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Clock, DateTime, Effect, FileSystem, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { expect } from "vitest";

import { readHeartbeats } from "../../../stacks/nest/alarm-collector.ts";
import { HeartbeatJson } from "../../pi-ratking/src/reader-health.ts";

const Reader = Schema.Struct({
  alive: Schema.Boolean,
  idleMinutes: Schema.Literals([0, 1, 4, 6, 30, 600]),
});

const exitedPid = Effect.gen(function* exitedPid() {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(ChildProcess.make("true", []));

  yield* child.exitCode;

  return Number(child.pid);
}).pipe(Effect.scoped);

it.live.prop(
  "a heartbeat whose pid is dead is ignored however stale; a live pid is stuck only after 5 idle minutes",
  [Schema.Array(Reader)],
  ([readers]) =>
    Effect.gen(function* heartbeats() {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const now = yield* Clock.currentTimeMillis;
      const exited = yield* exitedPid;

      // oxlint-disable-next-line unicorn/no-array-method-this-argument -- Effect.forEach takes an effectful callback, not an Array thisArg.
      yield* Effect.forEach(readers, (reader, index) =>
        Schema.encodeEffect(HeartbeatJson)({
          lastConsumeOk: DateTime.makeUnsafe(now - reader.idleMinutes * 60_000),
          lastError: "MailboxClientError/MailboxUnavailable",
          leaseHeldSince: null,
          name: `reader-${index}`,
          pid: reader.alive ? process.pid : exited,
          startedAt: DateTime.makeUnsafe(
            now - Math.floor(process.uptime() * 1000)
          ),
          state: "Retrying",
          updatedAt: DateTime.makeUnsafe(now),
        }).pipe(
          Effect.flatMap((json) =>
            fs.writeFileString(`${dir}/reader-${index}.json`, json)
          )
        )
      );

      const seen = yield* readHeartbeats({ dir, host: "host-invalid" });

      expect(
        Object.fromEntries(seen.map((reader) => [reader.name, reader.verdict]))
      ).toEqual(
        Object.fromEntries(
          readers.flatMap((reader, index) =>
            reader.alive
              ? [
                  [
                    `reader-${index}`,
                    reader.idleMinutes > 5 ? "stuck" : "running",
                  ],
                ]
              : []
          )
        )
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 20 }, timeout: 60_000 }
);

it.live(
  "a heartbeat whose pid now belongs to a process started after the beat is ignored, so a reused pid cannot keep a gone reader live",
  () =>
    Effect.gen(function* reusedPid() {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const now = yield* Clock.currentTimeMillis;

      const beat = (name: string, startedAt: number) =>
        Schema.encodeEffect(HeartbeatJson)({
          lastConsumeOk: DateTime.makeUnsafe(now - 600 * 60_000),
          lastError: null,
          leaseHeldSince: null,
          name,
          pid: process.pid,
          startedAt: DateTime.makeUnsafe(startedAt),
          state: "Live",
          updatedAt: DateTime.makeUnsafe(now),
        }).pipe(
          Effect.flatMap((json) =>
            fs.writeFileString(`${dir}/${name}.json`, json)
          )
        );

      yield* beat("current", now - Math.floor(process.uptime() * 1000));
      yield* beat("reused", now - 30 * 86_400_000);

      const seen = yield* readHeartbeats({ dir, host: "host-invalid" });

      expect(seen.map((reader) => [reader.name, reader.verdict])).toEqual([
        ["current", "stuck"],
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  30_000
);
