// @effect-diagnostics asyncFunction:off -- Alchemy captures cwd at import; select external state before importing it.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Config, Effect, FileSystem, Path, Schema } from "effect";

import { refuse } from "../../packages/alchemy-nest/src/files.ts";

const program = Effect.gen(function* launcher() {
  if ((yield* Config.String("ALCHEMY_TELEMETRY_DISABLED")) !== "1") {
    return yield* refuse("Disable Alchemy telemetry");
  }

  const action = yield* Schema.decodeUnknownEffect(
    Schema.Literals(["plan", "deploy", "destroy-plan", "destroy"])
  )(process.argv[2]);

  const offline = yield* Config.Boolean("RAT_KING_BILLING_OFFLINE_PLAN").pipe(
    Config.withDefault(true)
  );

  const approved =
    (yield* Config.String("RAT_KING_BILLING_DEPLOY_APPROVED").pipe(
      Config.withDefault("false")
    )) === "true";

  if ((!offline || action === "deploy" || action === "destroy") && !approved) {
    return yield* refuse(
      "Explicit billing deploy approval required for network or mutation"
    );
  }

  if (offline && (action === "deploy" || action === "destroy")) {
    return yield* refuse("Offline mode supports plans only");
  }

  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.realPath(path.resolve(import.meta.dirname, "../.."));
  const directory = path.resolve(yield* Config.String("RAT_KING_STATE_DIR"));

  if (directory === root || directory.startsWith(`${root}/`)) {
    return yield* refuse("State must be external");
  }

  yield* fs.makeDirectory(directory, { mode: 0o700, recursive: true });
  const canonical = yield* fs.realPath(directory);

  if (canonical === root || canonical.startsWith(`${root}/`)) {
    return yield* refuse("State resolves inside repository");
  }

  if (offline && (yield* fs.readDirectory(canonical)).length !== 0) {
    return yield* refuse(
      "Offline hypothetical plan requires a fresh empty state directory"
    );
  }

  yield* fs.chmod(canonical, 0o700);
  process.chdir(canonical);

  const runtime = yield* Effect.tryPromise({
    catch: () => refuse("Billing runtime import failed"),
    try: async () => await import("./runtime.ts"),
  });

  return yield* runtime.run(action, offline);
});

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)));
