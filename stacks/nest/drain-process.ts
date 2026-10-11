import { Effect, Result, Stream } from "effect";
import { ChildProcess } from "effect/process";
import type { ChildProcessSpawner } from "effect/process";

import { DrainFailure } from "./drain-error.ts";
import type { Line } from "./drain.ts";

export const executeBatch = (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  command: string,
  lines: readonly Line[]
) =>
  Effect.scoped(
    Effect.gen(function* execute() {
      const child = yield* spawner
        .spawn(
          ChildProcess.make("/bin/sh", ["-c", command], {
            stderr: "inherit",
            stdin: "pipe",
            stdout: "inherit",
          })
        )
        .pipe(
          Effect.mapError(
            () =>
              new DrainFailure({
                code: 2,
                reason:
                  "Could not start --exec. Check the command; nothing was acked.",
              })
          )
        );

      const input = Stream.fromIterable(lines).pipe(
        Stream.map((line) =>
          new TextEncoder().encode(`${JSON.stringify(line)}\n`)
        ),
        Stream.run(child.stdin),
        Effect.result
      );

      const [code, written] = yield* Effect.all([child.exitCode, input], {
        concurrency: "unbounded",
      }).pipe(
        Effect.mapError(
          () =>
            new DrainFailure({
              code: 3,
              reason:
                "Consumer status was not confirmed. Retry; nothing was acked.",
            })
        )
      );

      if (code === 0 && Result.isFailure(written)) {
        return yield* new DrainFailure({
          code: 3,
          reason: "Consumer stdin failed. Retry; nothing was acked.",
        });
      }

      return Number(code);
    })
  );
