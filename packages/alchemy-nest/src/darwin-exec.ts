import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Config, Effect, Schema } from "effect";

import { HostError } from "./host-error.ts";
import { readPrivateFile } from "./private-file.ts";

const failure = () =>
  new HostError({
    operation: "exec",
    reason: "Private LaunchAgent environment could not be loaded.",
  });

const main = Effect.gen(function* main() {
  const path = yield* Config.String("DARWIN_EXEC_FILE");
  const program = yield* Config.String("DARWIN_EXEC_PROGRAM");
  const text = yield* readPrivateFile(path).pipe(Effect.mapError(failure));

  const environment = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Record(Schema.String, Schema.String))
  )(text).pipe(Effect.mapError(failure));

  if (
    process.platform !== "darwin" ||
    process.execve === undefined ||
    !program.startsWith("/")
  ) {
    return yield* failure();
  }

  return yield* Effect.try({
    catch: failure,
    try: () => {
      process.execve?.(program, [program, ...process.argv.slice(2)], {
        ...environment,
        CELLD_OTEL: "0",
        OTEL_SDK_DISABLED: "true",
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      });
    },
  });
});

if (import.meta.main) {
  NodeRuntime.runMain(main.pipe(Effect.provide(NodeServices.layer)));
}
