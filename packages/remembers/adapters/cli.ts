#!/usr/bin/env node
import { NodeRuntime } from "@effect/platform-node";
import { Config, Effect, Layer, Redacted, Schema } from "effect";

import { Failure, SliceSource } from "../src/contract.ts";
import { cli, recallHelp } from "../src/recall.ts";
import { nodeCells } from "./node-sqlite.ts";
import { sliceHttp } from "./slices.ts";
import { sqliteLayer } from "./sqlite.ts";

const unavailable = Layer.succeed(
  SliceSource,
  SliceSource.of({
    defectCount: () =>
      Effect.fail(new Failure({ code: "recall_only", operation: "count" })),
    page: () =>
      Effect.fail(new Failure({ code: "recall_only", operation: "page" })),
    quote: () => Effect.succeed(null),
    read: () =>
      Effect.fail(new Failure({ code: "recall_only", operation: "read" })),
  })
);

const main = Effect.gen(function* main() {
  if (process.argv[2] === "--help" || process.argv[2] === "help") {
    process.stdout.write(`${recallHelp}\n`);

    return;
  }

  const config = yield* Config.all({
    control: Config.String("REMEMBERS_CONTROL_DB"),
    projects: Config.String("REMEMBERS_PROJECT_DBS"),
    sliceBearer: Config.Redacted("REMEMBERS_SLICE_BEARER").pipe(
      Config.withDefault(Redacted.make(""))
    ),
    sliceUrl: Config.String("REMEMBERS_SLICE_URL").pipe(Config.withDefault("")),
  });

  const projects = yield* Schema.decodeEffect(
    Schema.fromJsonString(Schema.Record(Schema.String, Schema.NonEmptyString))
  )(config.projects);

  const cells = nodeCells(
    config.control,
    new Map(Object.entries(projects)),
    true
  );

  const source =
    config.sliceUrl.length === 0
      ? unavailable
      : sliceHttp({
          baseUrl: config.sliceUrl,
          bearer: Redacted.value(config.sliceBearer),
          defectCount: () =>
            Effect.fail(
              new Failure({ code: "recall_only", operation: "count" })
            ),
          page: () =>
            Effect.fail(
              new Failure({ code: "recall_only", operation: "page" })
            ),
          transport: globalThis.fetch,
        });

  const result = yield* cli(process.argv.slice(2)).pipe(
    Effect.provide([sqliteLayer(false).pipe(Layer.provide(cells)), source])
  );

  process.stdout.write(`${result}\n`);
});

NodeRuntime.runMain(main);
