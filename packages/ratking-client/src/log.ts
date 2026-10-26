import { Effect, FileSystem, Option, Path, Predicate } from "effect";

import { withLock } from "./lock.ts";

export const LOG_MAX_BYTES = 5 * 1024 * 1024;

export const LOG_ARCHIVES = 2;

export const appendLog = Effect.fn("Client.appendLog")(function* appendLog(
  file: string,
  output: readonly string[]
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const encoder = new TextEncoder();
  yield* withLock(
    path.join(path.dirname(file), "locks"),
    "client-log",
    Effect.gen(function* flush() {
      let size = yield* fs.stat(file).pipe(
        Effect.map((info) => Number(info.size)),
        Effect.catchTag("PlatformError", (error) =>
          Predicate.isTagged(error.reason, "NotFound")
            ? Effect.succeed(0)
            : Effect.fail(error)
        )
      );

      for (const line of output) {
        const encoded = encoder.encode(`${line}\n`);

        const bytes =
          encoded.length <= LOG_MAX_BYTES
            ? encoded
            : encoder.encode(
                `${JSON.stringify({ droppedBytes: encoded.length, message: "Oversized client diagnostic omitted" })}\n`
              );

        if (size + bytes.length > LOG_MAX_BYTES) {
          for (let index = LOG_ARCHIVES; index >= 1; index -= 1) {
            const source = index === 1 ? file : `${file}.${index - 1}`;
            const destination = `${file}.${index}`;

            const exists = yield* fs.stat(source).pipe(
              Effect.map(Option.some),
              Effect.catchTag("PlatformError", (error) =>
                Predicate.isTagged(error.reason, "NotFound")
                  ? Effect.succeed(Option.none())
                  : Effect.fail(error)
              )
            );

            if (Option.isSome(exists)) {
              yield* fs.rename(source, destination);
              yield* fs.chmod(destination, 0o600);
            }
          }

          size = 0;
        }

        yield* fs.writeFile(file, bytes, { flag: "a", mode: 0o600 });
        yield* fs.chmod(file, 0o600);
        size += bytes.length;
      }
    })
  );
});
