import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Failure } from "@rat-king/remembers";
import { Effect, FileSystem, Schema } from "effect";

import { loadPrivate, readPrivate, workerBindings } from "./config.ts";

const failed = () =>
  new Failure({ code: "private_bindings", operation: "materialize" });

const main = Effect.gen(function* main() {
  const [root, source, target] = process.argv.slice(2);

  if (
    root === undefined ||
    source === undefined ||
    target === undefined ||
    !target.startsWith("/")
  ) {
    return yield* failed();
  }

  const fs = yield* FileSystem.FileSystem;
  const stat = yield* fs.stat(source).pipe(Effect.mapError(failed));

  if (stat.type !== "File" || stat.mode % 0o1000 !== 0o600) {
    return yield* failed();
  }

  const config = yield* loadPrivate(root);

  const base = yield* readPrivate(source).pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(
        Schema.fromJsonString(
          Schema.Struct({
            MISCHIEF_CALLERS: Schema.NonEmptyString,
            MISCHIEF_CLIPROXY_KEY: Schema.NonEmptyString,
            MISCHIEF_CLIPROXY_URL: Schema.NonEmptyString,
            MISCHIEF_DID: Schema.NonEmptyString,
            MISCHIEF_MODEL: Schema.NonEmptyString,
          })
        ),
        { onExcessProperty: "error" }
      )
    ),
    Effect.mapError(failed)
  );

  const bindings = workerBindings(config);

  return yield* fs
    .writeFileString(target, JSON.stringify({ ...base, ...bindings }), {
      flag: "wx",
      mode: 0o600,
    })
    .pipe(Effect.mapError(failed));
}).pipe(Effect.provide(NodeServices.layer));

if (import.meta.main) {
  NodeRuntime.runMain(main);
}
