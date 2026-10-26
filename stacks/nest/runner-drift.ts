import { Effect, FileSystem, Option, Schema } from "effect";

import { ShipCheckpoint } from "./ship-config.ts";

export const shippedDrift = <E, R>(
  read: Effect.Effect<Option.Option<string>, E, R>
) =>
  read.pipe(
    Effect.map((started) =>
      read.pipe(
        Effect.map(
          (now) =>
            Option.isSome(started) &&
            Option.isSome(now) &&
            now.value !== started.value
        )
      )
    )
  );

export const readShippedSha = (checkpoint: string | undefined) =>
  Effect.gen(function* shipped() {
    if (checkpoint === undefined) {
      return Option.none<string>();
    }

    const fs = yield* FileSystem.FileSystem;

    if (!(yield* fs.exists(checkpoint))) {
      return Option.none<string>();
    }

    const saved = yield* Schema.decodeEffect(
      Schema.fromJsonString(ShipCheckpoint)
    )(yield* fs.readFileString(checkpoint));

    return saved.successful === ""
      ? Option.none<string>()
      : Option.some<string>(saved.successful);
  }).pipe(Effect.orElseSucceed(() => Option.none<string>()));
