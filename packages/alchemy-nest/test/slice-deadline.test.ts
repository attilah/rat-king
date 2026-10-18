import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Clock, Effect, Schema, Stream } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { expect } from "vitest";

import { executeCountProcess } from "../src/slice-count.ts";

const slowQuery = `
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
process.stderr.write('SLOW_QUERY_READY');
db.prepare('WITH RECURSIVE n(x) AS (SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x<1000000000000) SELECT sum(x) FROM n').get();
`;

const absentProcess = Schema.is(
  Schema.Struct({ code: Schema.Literal("ESRCH") })
);

it.live(
  "count deadline SIGKILLs an actual SQLite scan and reaps its OS process",
  () =>
    Effect.gen(function* deadline() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      let pid = 0;
      let scanning = false;

      const observed = ChildProcessSpawner.ChildProcessSpawner.of({
        ...spawner,
        spawn: Effect.fn("Test.count.observe")(function* spawn(command) {
          const handle = yield* spawner.spawn(command);
          pid = Number(handle.pid);

          return {
            ...handle,
            stderr: handle.stderr.pipe(
              Stream.tap((part) =>
                Effect.sync(() => {
                  if (
                    Buffer.from(part)
                      .toString("utf-8")
                      .includes("SLOW_QUERY_READY")
                  ) {
                    scanning = true;
                  }
                })
              )
            ),
          };
        }),
      });

      const started = yield* Clock.currentTimeMillis;

      const failure = yield* Effect.flip(
        executeCountProcess(slowQuery, {
          literal: "invented literal",
          path: "/srv/example/unused.db",
          role: null,
          since: 0,
        }).pipe(
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            observed
          )
        )
      );

      const elapsed = (yield* Clock.currentTimeMillis) - started;
      expect(failure.status).toBe(408);
      expect(scanning).toBe(true);
      expect(pid).toBeGreaterThan(0);
      expect(elapsed).toBeGreaterThanOrEqual(9900);
      expect(elapsed).toBeLessThan(13_000);

      const reaped = yield* Effect.sync(() => {
        try {
          process.kill(pid, 0);

          return false;
        } catch (error) {
          return absentProcess(error);
        }
      });

      expect(reaped).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
