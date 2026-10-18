import { Effect, FileSystem, Option } from "effect";

import { HostError } from "./host-error.ts";

export const readPrivateFile = Effect.fn("Darwin.privateFile")(function* read(
  path: string
) {
  const fs = yield* FileSystem.FileSystem;
  const entry = yield* fs.stat(path);

  if (
    entry.type !== "File" ||
    entry.mode % 0o1000 !== 0o600 ||
    Option.getOrUndefined(entry.uid) !== process.getuid?.() ||
    (yield* fs.realPath(path)) !== path
  ) {
    return yield* new HostError({
      operation: "read",
      reason: "Private file custody check failed.",
    });
  }

  return yield* fs.readFileString(path);
});
