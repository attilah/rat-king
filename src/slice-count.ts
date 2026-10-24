import { Effect, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { sliceCountScript } from "./slice-count-script.ts";
import {
  CountResultSchema,
  maxSliceBytes,
  SliceError,
} from "./slice-source.ts";
import type { Signature } from "./slice-source.ts";

export interface CountInput {
  readonly path: string;
  readonly literal: string;
  readonly role: string | null;
  readonly since: number;
}

const failed = () =>
  new SliceError({ reason: "Count query failed.", status: 500 });

export const executeCountProcess = Effect.fn("SliceSource.countProcess")(
  function* execute(script: string, input: CountInput) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const handle = yield* spawner
      .spawn(
        ChildProcess.make(
          "/usr/bin/nice",
          [
            "-n",
            "10",
            process.execPath,
            "--max-old-space-size=64",
            "--input-type=commonjs",
            "-e",
            script,
          ],
          {
            env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
            extendEnv: false,
            killSignal: "SIGKILL",
            stdin: Stream.make(new TextEncoder().encode(JSON.stringify(input))),
          }
        )
      )
      .pipe(Effect.mapError(failed));

    let bytes = 0;

    const output = handle.stdout.pipe(
      Stream.mapError(failed),
      Stream.mapEffect(
        Effect.fn("SliceSource.countOutput")(function* output(part) {
          bytes += part.length;

          if (bytes > maxSliceBytes) {
            return yield* new SliceError({
              reason: "Count output exceeds limit.",
              status: 413,
            });
          }

          return part;
        })
      ),
      Stream.runCollect
    );

    const result = yield* Effect.all(
      {
        code: handle.exitCode.pipe(Effect.mapError(failed)),
        output,
        stderr: Stream.runDrain(handle.stderr).pipe(Effect.mapError(failed)),
      },
      { concurrency: "unbounded" }
    ).pipe(
      Effect.timeout("10 seconds"),
      Effect.catchTag("TimeoutError", () =>
        Effect.fail(
          new SliceError({
            reason: "Count query exceeded deadline.",
            status: 408,
          })
        )
      )
    );

    if (Number(result.code) !== 0) {
      return yield* failed();
    }

    return yield* Schema.decodeEffect(Schema.fromJsonString(CountResultSchema))(
      Buffer.concat(result.output).toString("utf-8")
    ).pipe(Effect.mapError(failed));
  },
  Effect.scoped
);

export const countInProcess = (path: string, signature: Signature) =>
  executeCountProcess(sliceCountScript, {
    literal: signature.literal,
    path,
    role: signature.role ?? null,
    since: signature.since_ms,
  });
