import { Failure, SliceKey } from "@rat-king/remembers";
import { Config, Effect, FileSystem, Option, Redacted, Schema } from "effect";

const failed = () => new Failure({ code: "private_config", operation: "load" });

export const readPrivate = Effect.fn("RemembersHost.readPrivate")(
  function* readPrivate(path: string) {
    const fs = yield* FileSystem.FileSystem;

    return yield* fs
      .readFileString(path)
      .pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.NonEmptyString)),
        Effect.mapError(failed)
      );
  }
);

export const loadPrivate = (root: string) =>
  Effect.gen(function* readConfiguration() {
    const config = yield* Config.all({
      canary: Config.option(Config.String("REMEMBERS_CANARY_KEY")),
      canonPaths: Config.String("REMEMBERS_CANON_PATHS"),
      epoch: Config.Int("REMEMBERS_EPOCH").pipe(Config.withDefault(0)),
      from: Config.option(Config.String("REMEMBERS_FROM_DAY")),
      idleMs: Config.Int("REMEMBERS_IDLE_MS").pipe(
        Config.withDefault(1_200_000)
      ),
      mailbox: Config.String("REMEMBERS_MAILBOX_CONFIG_PATH"),
      mode: Config.String("REMEMBERS_MODE").pipe(Config.withDefault("nightly")),
      observer: Config.String("REMEMBERS_OBSERVER_PREFIX_PATH"),
      owner: Config.String("REMEMBERS_OWNER"),
      projects: Config.String("REMEMBERS_PROJECTS"),
      rubric: Config.String("REMEMBERS_JUDGE_RUBRIC_PATH"),
      sliceBearer: Config.Redacted("REMEMBERS_SLICE_BEARER"),
      sliceUrl: Config.String("REMEMBERS_SLICE_URL"),
      threshold: Config.Number("REMEMBERS_LOAD_THRESHOLD").pipe(
        Config.withDefault(40)
      ),
      through: Config.option(Config.String("REMEMBERS_THROUGH_DAY")),
      workerDid: Config.String("REMEMBERS_WORKER_DID"),
      workerUrl: Config.String("REMEMBERS_WORKER_URL"),
    }).pipe(Effect.mapError(failed));

    const paths = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(Schema.NonEmptyArray(Schema.NonEmptyString))
    )(config.canonPaths).pipe(Effect.mapError(failed));

    const projects = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(Schema.NonEmptyArray(Schema.NonEmptyString))
    )(config.projects).pipe(Effect.mapError(failed));

    const prefix = yield* readPrivate(config.observer);
    const rubric = yield* readPrivate(config.rubric);

    const canon = yield* Effect.forEach((path: string) => readPrivate(path))(
      paths
    );

    const canary = Option.isSome(config.canary)
      ? yield* Schema.decodeUnknownEffect(Schema.fromJsonString(SliceKey))(
          config.canary.value
        ).pipe(Effect.mapError(failed))
      : null;

    if (
      !root.startsWith("/") ||
      root.endsWith("/") ||
      !["nightly", "catch-up", "canary", "off"].includes(config.mode) ||
      config.idleMs < 1 ||
      config.epoch < 0 ||
      !Number.isFinite(config.threshold) ||
      config.threshold <= 0 ||
      new Set(projects).size !== projects.length
    ) {
      return yield* failed();
    }

    return { ...config, canary, canon, prefix, projects, root, rubric };
  });

export type HostConfig = Effect.Success<ReturnType<typeof loadPrivate>>;

export const workerBindings = (config: HostConfig) => ({
  REMEMBERS_CANON_JSON: JSON.stringify(config.canon),
  REMEMBERS_SLICE_BEARER: Redacted.value(config.sliceBearer),
  REMEMBERS_SLICE_URL: config.sliceUrl,
});
